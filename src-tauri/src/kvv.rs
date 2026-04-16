use diesel::prelude::*;
use serde_json::Value;

use crate::db::{upsert_stop, upsert_stops, NewStop, Stop};
use crate::helpers::{
    attr_value, haversine_km, json_to_i64, parse_time_field, shorten_line_number,
    trim_path_to_last_stop, trip_code_from_realtime_trip_id,
};
use crate::types::{Departure, TripRouteStop, TripStopSeqResponse};
use crate::AppState;

// ── Build-time API base URLs (override via .env at compile time) ──────────────

const EFA_BASE: &str = match option_env!("KVV_EFA_BASE_URL") {
    Some(v) => v,
    None => "https://projekte.kvv-efa.de/sl3-alone",
};

const COORD_BASE: &str = match option_env!("KVV_COORD_BASE_URL") {
    Some(v) => v,
    None => "https://www.kvv.de/tunnelEfaDirect.php",
};

// ── Shared HTTP helpers ───────────────────────────────────────────────────────

async fn get_json(http: &reqwest::Client, url: &str) -> Result<Value, String> {
    http.get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())
}

/// Fetch a URL that returns JSONP (e.g. `callbackName({...})`), strip the wrapper,
/// and parse the inner JSON object.
async fn get_jsonp(http: &reqwest::Client, url: impl reqwest::IntoUrl) -> Result<Value, String> {
    let raw = http
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let start = raw.find('(').ok_or("JSONP: missing '('")?;
    let end = raw.rfind(')').ok_or("JSONP: missing ')'")?;
    let json_str = raw[start + 1..end].trim();
    serde_json::from_str(json_str).map_err(|e| e.to_string())
}

// ── KVV API commands ──────────────────────────────────────────────────────────

/// Call the KVV API for one stop ID and return a `Stop` (not yet persisted).
pub async fn fetch_stop(http: &reqwest::Client, stop_id: &str) -> Result<Stop, String> {
    let url = format!(
        "{EFA_BASE}/XSLT_DM_REQUEST\
?outputFormat=JSON&coordOutputFormat=WGS84[dd.ddddd]&depType=stopEvents\
&locationServerActive=1&mode=direct&name_dm={stop_id}&type_dm=stop\
&useOnlyStops=1&useRealtime=1&limit=30"
    );

    let resp = get_json(http, &url).await?;

    let point_val = &resp["dm"]["points"];
    let point = if point_val.is_array() {
        &point_val[0]["point"]
    } else {
        &point_val["point"]
    };

    let name = point["name"].as_str().ok_or("missing name")?.to_string();
    let id = point["ref"]["id"].as_str().ok_or("missing id")?.to_string();
    let coords = point["ref"]["coords"].as_str().ok_or("missing coords")?;

    let mut parts = coords.split(',');
    let longitude: f64 = parts
        .next()
        .ok_or("missing lon")?
        .parse()
        .map_err(|e: std::num::ParseFloatError| e.to_string())?;
    let latitude: f64 = parts
        .next()
        .ok_or("missing lat")?
        .parse()
        .map_err(|e: std::num::ParseFloatError| e.to_string())?;

    Ok(Stop {
        id,
        name,
        longitude,
        latitude,
    })
}

#[tauri::command]
pub async fn fetch_departures(
    state: tauri::State<'_, AppState>,
    stop_id: String,
) -> Result<Vec<Departure>, String> {
    let url = format!(
        "{EFA_BASE}/XSLT_DM_REQUEST\
?outputFormat=JSON&coordOutputFormat=WGS84[dd.ddddd]&depType=stopEvents\
&locationServerActive=1&mode=direct&name_dm={stop_id}&type_dm=stop\
&useOnlyStops=1&useRealtime=1&limit=30"
    );

    let resp = get_json(&state.http, &url).await?;

    let Some(list) = resp["departureList"].as_array() else {
        return Ok(vec![]);
    };

    let mut departures = Vec::with_capacity(list.len());
    for d in list {
        let sl = &d["servingLine"];
        let dt = &d["dateTime"];
        let rdt = if d["realDateTime"].is_object() {
            &d["realDateTime"]
        } else {
            dt
        };
        let platform = match &d["platform"] {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        let realtime_trip_id = attr_value(d, "RealtimeTripId").unwrap_or_default();
        let trip_code = attr_value(sl, "TRIP_CODE")
            .or_else(|| sl["tripCode"].as_str().map(|v| v.to_string()))
            .or_else(|| sl["key"].as_str().map(|v| v.to_string()))
            .or_else(|| sl["key"].as_i64().map(|v| v.to_string()))
            .or_else(|| trip_code_from_realtime_trip_id(&realtime_trip_id))
            .unwrap_or_default();
        departures.push(Departure {
            stop_name: d["stopName"].as_str().unwrap_or("").to_string(),
            stop_id: d["stopID"].as_str().unwrap_or(&stop_id).to_string(),
            line: shorten_line_number(sl["number"].as_str().unwrap_or("")),
            line_type: sl["name"].as_str().unwrap_or("").to_string(),
            mot_type: sl["motType"].as_str().unwrap_or("").to_string(),
            direction: sl["direction"].as_str().unwrap_or("").to_string(),
            platform,
            planned_time: parse_time_field(&dt["hour"], &dt["minute"]),
            real_time: parse_time_field(&rdt["hour"], &rdt["minute"]),
            delay_minutes: json_to_i64(&sl["delay"]),
            countdown: json_to_i64(&d["countdown"]),
            trip_code,
            line_stateless: sl["stateless"].as_str().unwrap_or("").to_string(),
            realtime_trip_id,
            avms_trip_id: attr_value(d, "AVMSTripID").unwrap_or_default(),
            service_date: format!(
                "{:0>4}{:0>2}{:0>2}",
                dt["year"].as_str().unwrap_or(""),
                dt["month"].as_str().unwrap_or(""),
                dt["day"].as_str().unwrap_or("")
            ),
            service_time: format!(
                "{:0>2}.{:0>2}.00",
                dt["hour"].as_str().unwrap_or(""),
                dt["minute"].as_str().unwrap_or("")
            ),
        });
    }
    Ok(departures)
}

#[tauri::command]
pub async fn fetch_trip_stopseq(
    state: tauri::State<'_, AppState>,
    stop_id: String,
    line_stateless: String,
    trip_code: String,
    service_date: String,
    service_time: String,
) -> Result<TripStopSeqResponse, String> {
    let mut url = reqwest::Url::parse(COORD_BASE).map_err(|e| e.to_string())?;
    url.query_pairs_mut()
        .append_pair("action", "XML_STOPSEQCOORD_REQUEST")
        .append_pair("jsonp", "jsonpFn6")
        .append_pair("line", &line_stateless)
        .append_pair("stop", &stop_id)
        .append_pair("tripCode", &trip_code)
        .append_pair("date", &service_date)
        .append_pair("time", &service_time)
        .append_pair("coordOutputFormat", "WGS84[DD.DDDDD]")
        .append_pair("coordListOutputFormat", "string")
        .append_pair("outputFormat", "json")
        .append_pair("tStOTType", "NEXT")
        .append_pair("hideBannerInfo", "1");

    let resp = get_jsonp(&state.http, url).await?;

    let mode = &resp["stopSeqCoords"]["params"]["mode"];
    let trip_code_value = mode["diva"]["tripCode"]
        .as_str()
        .map(|v| v.to_string())
        .or_else(|| mode["diva"]["tripCode"].as_i64().map(|v| v.to_string()))
        .unwrap_or_else(|| trip_code.clone());

    let stop_seq = resp["stopSeqCoords"]["params"]["stopSeq"]
        .as_array()
        .ok_or("missing stop sequence")?;

    let mut route_stops = Vec::with_capacity(stop_seq.len());
    for stop in stop_seq {
        let ref_obj = &stop["ref"];
        let coords = ref_obj["coords"].as_str().unwrap_or("");
        let mut coord_parts = coords.split(',');
        let longitude = coord_parts.next().and_then(|v| v.parse::<f64>().ok());
        let latitude = coord_parts.next().and_then(|v| v.parse::<f64>().ok());
        route_stops.push(TripRouteStop {
            id: ref_obj["id"].as_str().unwrap_or("").to_string(),
            name: stop["name"].as_str().unwrap_or("").to_string(),
            platform: stop["platformName"].as_str().unwrap_or("").to_string(),
            arrival_time: ref_obj["arrDateTimeSec"]
                .as_str()
                .or_else(|| ref_obj["arrDateTime"].as_str())
                .unwrap_or("")
                .to_string(),
            departure_time: ref_obj["depDateTimeSec"]
                .as_str()
                .or_else(|| ref_obj["depDateTime"].as_str())
                .unwrap_or("")
                .to_string(),
            longitude,
            latitude,
        });
    }

    let raw_path = resp["stopSeqCoords"]["coords"]["path"]
        .as_str()
        .unwrap_or("");
    let trimmed_path = trim_path_to_last_stop(raw_path, &route_stops);

    Ok(TripStopSeqResponse {
        trip_code: trip_code_value,
        line_stateless: mode["diva"]["stateless"].as_str().unwrap_or("").to_string(),
        line_name: mode["name"].as_str().unwrap_or("").to_string(),
        line_number: mode["number"].as_str().unwrap_or("").to_string(),
        destination: mode["destination"].as_str().unwrap_or("").to_string(),
        path: trimmed_path,
        route_stops,
    })
}

#[tauri::command]
pub async fn search_stops(
    state: tauri::State<'_, AppState>,
    query: String,
) -> Result<Vec<Stop>, String> {
    let encoded = query.replace(' ', "+");
    let url = format!(
        "{EFA_BASE}/XSLT_STOPFINDER_REQUEST\
?outputFormat=JSON&coordOutputFormat=WGS84[dd.ddddd]\
&locationServerActive=1&type_sf=any&name_sf={encoded}&anyObjFilter_sf=2"
    );

    let resp = get_json(&state.http, &url).await?;

    let points_val = &resp["stopFinder"]["points"];
    let points: Vec<&Value> = if points_val.is_array() {
        points_val.as_array().unwrap().iter().collect()
    } else if points_val.is_object() {
        vec![points_val]
    } else {
        return Ok(vec![]);
    };

    let mut stops = Vec::new();
    for p in points {
        if !p.is_object() {
            continue;
        }
        let name = match p["name"].as_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let id = match p["ref"]["id"].as_str() {
            Some(s) => s.to_string(),
            None => continue,
        };
        let coords = match p["ref"]["coords"].as_str() {
            Some(s) => s,
            None => continue,
        };
        let mut parts = coords.split(',');
        let longitude: f64 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(v) => v,
            None => continue,
        };
        let latitude: f64 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(v) => v,
            None => continue,
        };
        stops.push(Stop {
            id,
            name,
            longitude,
            latitude,
        });
    }
    Ok(stops)
}

#[tauri::command]
pub fn search_stops_db(state: tauri::State<AppState>, query: String) -> Result<Vec<Stop>, String> {
    use crate::schema::stops;
    let pattern = format!("%{}%", query);
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    stops::table
        .filter(stops::name.like(&pattern))
        .limit(30)
        .load::<Stop>(&mut *conn)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_and_store_stop(
    state: tauri::State<'_, AppState>,
    stop_id: String,
) -> Result<Stop, String> {
    let stop = fetch_stop(&state.http, &stop_id).await?;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    upsert_stop(
        &mut conn,
        NewStop {
            id: &stop.id,
            name: &stop.name,
            longitude: stop.longitude,
            latitude: stop.latitude,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(stop)
}

#[tauri::command]
pub async fn fetch_and_store_stops(
    state: tauri::State<'_, AppState>,
    stop_ids: Vec<String>,
) -> Result<Vec<Result<Stop, String>>, String> {
    let mut results = Vec::with_capacity(stop_ids.len());
    for id in &stop_ids {
        match fetch_stop(&state.http, id).await {
            Ok(stop) => match state.db.lock() {
                Ok(mut conn) => match upsert_stop(
                    &mut conn,
                    NewStop {
                        id: &stop.id,
                        name: &stop.name,
                        longitude: stop.longitude,
                        latitude: stop.latitude,
                    },
                ) {
                    Ok(_) => results.push(Ok(stop)),
                    Err(e) => results.push(Err(e.to_string())),
                },
                Err(e) => results.push(Err(e.to_string())),
            },
            Err(e) => results.push(Err(e)),
        }
    }
    Ok(results)
}

#[tauri::command]
pub fn get_stops(state: tauri::State<AppState>) -> Result<Vec<Stop>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    crate::db::list_stops(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn fetch_stops_near(
    state: tauri::State<'_, AppState>,
    latitude: f64,
    longitude: f64,
    radius_km: f64,
    limit: Option<usize>,
) -> Result<Vec<Stop>, String> {
    let delta_lat = radius_km / 111.32;
    let delta_lon = radius_km / (111.32 * latitude.to_radians().cos());

    let min_lon = longitude - delta_lon;
    let max_lat = latitude + delta_lat;
    let max_lon = longitude + delta_lon;
    let min_lat = latitude - delta_lat;

    let bounds_lu = format!("{min_lon:.5}:{max_lat:.5}:WGS84[DD.DDDDD]");
    let bounds_rl = format!("{max_lon:.5}:{min_lat:.5}:WGS84[DD.DDDDD]");

    let mut stops = fetch_stops_in_bounds_inner(&state, &bounds_lu, &bounds_rl).await?;
    stops.sort_by(|a, b| {
        let da = haversine_km(latitude, longitude, a.latitude, a.longitude);
        let db = haversine_km(latitude, longitude, b.latitude, b.longitude);
        da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
    });
    stops.truncate(limit.unwrap_or(8));
    Ok(stops)
}

#[tauri::command]
pub async fn fetch_stops_in_bounds(
    state: tauri::State<'_, AppState>,
    bounds_lu: String,
    bounds_rl: String,
) -> Result<Vec<Stop>, String> {
    fetch_stops_in_bounds_inner(&state, &bounds_lu, &bounds_rl).await
}

async fn fetch_stops_in_bounds_inner(
    state: &tauri::State<'_, AppState>,
    bounds_lu: &str,
    bounds_rl: &str,
) -> Result<Vec<Stop>, String> {
    let url = format!(
        "{COORD_BASE}?action=XSLT_COORD_REQUEST\
&jsonp=jsonpFn1&boundingBox=\
&boundingBoxLU={bounds_lu}\
&boundingBoxRL={bounds_rl}\
&coordOutputFormat=WGS84[DD.DDDDD]&outputFormat=json&inclFilter=1&type_1=STOP"
    );

    let resp = get_jsonp(&state.http, &url).await?;
    let pins = resp["pins"].as_array().ok_or("missing pins array")?;

    let mut stops: Vec<Stop> = Vec::with_capacity(pins.len());
    for pin in pins {
        let id = match pin["id"].as_str() {
            Some(v) => v.to_string(),
            None => continue,
        };
        let name = pin["attrs"]
            .as_array()
            .and_then(|attrs| {
                attrs
                    .iter()
                    .find(|a| a["name"] == "STOP_NAME_WITH_PLACE")
                    .and_then(|a| a["value"].as_str())
                    .map(|s| s.to_string())
            })
            .or_else(|| pin["desc"].as_str().map(|s| s.to_string()))
            .unwrap_or_default();

        let coords = match pin["coords"].as_str() {
            Some(v) => v,
            None => continue,
        };
        let mut parts = coords.split(',');
        let longitude: f64 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(v) => v,
            None => continue,
        };
        let latitude: f64 = match parts.next().and_then(|s| s.parse().ok()) {
            Some(v) => v,
            None => continue,
        };

        stops.push(Stop {
            id,
            name,
            longitude,
            latitude,
        });
    }

    let new_stops: Vec<NewStop> = stops
        .iter()
        .map(|s| NewStop {
            id: &s.id,
            name: &s.name,
            longitude: s.longitude,
            latitude: s.latitude,
        })
        .collect();

    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    upsert_stops(&mut conn, new_stops).map_err(|e| e.to_string())?;

    Ok(stops)
}
