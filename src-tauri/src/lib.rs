mod db;
mod schema;

use db::{
    delete_network, establish_connection, list_networks, list_stops, upsert_network, upsert_stop,
    upsert_stops, Network, NewNetwork, NewStop, Stop,
};
use diesel::prelude::*;
use diesel::sqlite::SqliteConnection;
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;

// ── Build-time API base URLs (override via .env at compile time) ──────────────

const KVV_EFA_BASE: &str = match option_env!("KVV_EFA_BASE_URL") {
    Some(v) => v,
    None => "https://projekte.kvv-efa.de/sl3-alone",
};

const KVV_COORD_BASE: &str = match option_env!("KVV_COORD_BASE_URL") {
    Some(v) => v,
    None => "https://www.kvv.de/tunnelEfaDirect.php",
};

// ── Departure types ───────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct Departure {
    pub stop_name: String,
    pub stop_id: String,
    pub line: String,
    pub line_type: String,
    pub mot_type: String,
    pub direction: String,
    pub platform: String,
    pub planned_time: String,
    pub real_time: String,
    pub delay_minutes: i64,
    pub countdown: i64,
    pub trip_code: String,
    pub line_stateless: String,
    pub realtime_trip_id: String,
    pub avms_trip_id: String,
    pub service_date: String,
    pub service_time: String,
}

#[derive(Serialize, Debug)]
pub struct TripRouteStop {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub arrival_time: String,
    pub departure_time: String,
    pub longitude: Option<f64>,
    pub latitude: Option<f64>,
}

#[derive(Serialize, Debug)]
pub struct TripStopSeqResponse {
    pub trip_code: String,
    pub line_stateless: String,
    pub line_name: String,
    pub line_number: String,
    pub destination: String,
    pub path: String,
    pub route_stops: Vec<TripRouteStop>,
}

// ── Shared helpers ─────────────────────────────────────────────────────────────

fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6371.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    R * 2.0 * a.sqrt().asin()
}

struct DbState(Mutex<SqliteConnection>);

fn http_client(timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .connect_timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| e.to_string())
}

// ── KVV DM helper ──────────────────────────────────────────────────────────────

/// Shorten verbose line numbers like "ICE 372 InterCityExpress" → "ICE 372".
/// Keeps the prefix (ICE/IC/EC/TGV/RJ/…) plus the train number, drops the rest.
fn shorten_line_number(raw: &str) -> String {
    let prefixes = [
        "ICE", "IC", "EC", "TGV", "RJX", "RJ", "EN", "NJ", "FLX", "THA",
    ];
    for pfx in prefixes {
        if let Some(after) = raw.strip_prefix(pfx) {
            let rest = after.trim_start();
            let num_end = rest
                .find(|c: char| !c.is_ascii_digit())
                .unwrap_or(rest.len());
            if num_end > 0 {
                return format!("{pfx} {}", &rest[..num_end]);
            }
            return pfx.to_string();
        }
    }
    raw.to_string()
}

fn parse_time_field(h: &Value, m: &Value) -> String {
    let hh = h.as_str().unwrap_or("0");
    let mm = m.as_str().unwrap_or("0");
    format!("{hh:0>2}:{mm:0>2}")
}

fn json_to_i64(v: &Value) -> i64 {
    v.as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| v.as_i64())
        .unwrap_or(0)
}

fn attr_value(obj: &Value, name: &str) -> Option<String> {
    obj["attrs"].as_array().and_then(|attrs| {
        attrs.iter().find_map(|a| {
            if a["name"].as_str() == Some(name) {
                a["value"].as_str().map(|v| v.to_string())
            } else {
                None
            }
        })
    })
}

/// KVV `RealtimeTripId` often embeds a numeric trip token after `T0.` (e.g. `...T0.1385...`).
fn trip_code_from_realtime_trip_id(id: &str) -> Option<String> {
    const NEEDLE: &str = "T0.";
    let start = id.rfind(NEEDLE)? + NEEDLE.len();
    let rest = id.get(start..)?;
    let end = rest
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(rest.len());
    if end == 0 {
        return None;
    }
    Some(rest[..end].to_string())
}

fn get_db_path(app: &tauri::AppHandle) -> String {
    #[cfg(target_os = "android")]
    {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .expect("Failed to resolve Android app data directory");
        std::fs::create_dir_all(&app_data_dir)
            .expect("Failed to create Android app data directory");
        return app_data_dir.join("stops.db").to_string_lossy().to_string();
    }

    #[cfg(not(target_os = "android"))]
    {
        let data_dir = dirs::data_local_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        let app_dir = data_dir.join("ka-cityrail-navigator");
        std::fs::create_dir_all(&app_dir).ok();
        let _ = app;
        app_dir.join("stops.db").to_string_lossy().to_string()
    }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/// Call the KVV API for one stop ID and return a `Stop` (not yet persisted).
fn fetch_stop(stop_id: &str) -> Result<Stop, String> {
    let url = format!(
        "{KVV_EFA_BASE}/XSLT_DM_REQUEST\
?outputFormat=JSON&coordOutputFormat=WGS84[dd.ddddd]&depType=stopEvents\
&locationServerActive=1&mode=direct&name_dm={stop_id}&type_dm=stop\
&useOnlyStops=1&useRealtime=1&limit=30"
    );

    let resp: Value = http_client(10)?
        .get(&url)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

    // dm.points may be a single object or an array
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

/// Fetch departures for a given stop ID from the KVV real-time API.
#[tauri::command]
fn fetch_departures(stop_id: String) -> Result<Vec<Departure>, String> {
    let url = format!(
        "{KVV_EFA_BASE}/XSLT_DM_REQUEST\
?outputFormat=JSON&coordOutputFormat=WGS84[dd.ddddd]&depType=stopEvents\
&locationServerActive=1&mode=direct&name_dm={stop_id}&type_dm=stop\
&useOnlyStops=1&useRealtime=1&limit=30"
    );

    let resp: Value = http_client(15)?
        .get(&url)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

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
fn fetch_trip_stopseq(
    stop_id: String,
    line_stateless: String,
    trip_code: String,
    service_date: String,
    service_time: String,
) -> Result<TripStopSeqResponse, String> {
    let mut url = reqwest::Url::parse(KVV_COORD_BASE).map_err(|e| e.to_string())?;
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

    let raw = http_client(10)?
        .get(url)
        .send()
        .map_err(|e| e.to_string())?
        .text()
        .map_err(|e| e.to_string())?;

    let start = raw
        .find('(')
        .ok_or("unexpected JSONP format: missing '('")?;
    let end = raw
        .rfind(')')
        .ok_or("unexpected JSONP format: missing ')'")?;
    let json_str = raw[start + 1..end].trim();
    let resp: Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

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

/// Trim path coordinates to the segment ending at the last route stop.
/// The KVV API sometimes appends a backtracking segment past the terminus.
fn trim_path_to_last_stop(raw_path: &str, stops: &[TripRouteStop]) -> String {
    let last = match stops.last() {
        Some(s) => s,
        None => return raw_path.to_string(),
    };
    let (target_lon, target_lat) = match (last.longitude, last.latitude) {
        (Some(lon), Some(lat)) => (lon, lat),
        _ => return raw_path.to_string(),
    };

    let pairs: Vec<&str> = raw_path.split_whitespace().collect();
    let mut best_idx = pairs.len().saturating_sub(1);
    let mut best_dist = f64::MAX;
    for (i, pair) in pairs.iter().enumerate() {
        let mut parts = pair.split(',');
        if let (Some(lon_s), Some(lat_s)) = (parts.next(), parts.next()) {
            if let (Ok(lon), Ok(lat)) = (lon_s.parse::<f64>(), lat_s.parse::<f64>()) {
                let d = (lon - target_lon).powi(2) + (lat - target_lat).powi(2);
                if d < best_dist {
                    best_dist = d;
                    best_idx = i;
                }
            }
        }
    }
    pairs[..=best_idx].join(" ")
}

/// Search for stops by name using the KVV StopFinder API.
/// Returns stops matching the query (not persisted to DB).
#[tauri::command]
fn search_stops(query: String) -> Result<Vec<Stop>, String> {
    let encoded = query.replace(' ', "+");
    let url = format!(
        "{KVV_EFA_BASE}/XSLT_STOPFINDER_REQUEST\
?outputFormat=JSON&coordOutputFormat=WGS84[dd.ddddd]\
&locationServerActive=1&type_sf=any&name_sf={encoded}&anyObjFilter_sf=2"
    );

    let resp: Value = http_client(10)?
        .get(&url)
        .send()
        .map_err(|e| e.to_string())?
        .json()
        .map_err(|e| e.to_string())?;

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
        // KVV stopfinder returns type "any" for stops; skip non-object entries
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

/// Search the local DB for stops whose name contains the query string.
#[tauri::command]
fn search_stops_db(state: tauri::State<DbState>, query: String) -> Result<Vec<Stop>, String> {
    use crate::schema::stops;
    let pattern = format!("%{}%", query);
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    stops::table
        .filter(stops::name.like(&pattern))
        .limit(30)
        .load::<Stop>(&mut *conn)
        .map_err(|e| e.to_string())
}

/// Fetch a single stop by ID from the KVV API and persist it to the local DB.
/// Utility/admin command — not called from the main UI.
#[tauri::command]
fn fetch_and_store_stop(state: tauri::State<DbState>, stop_id: String) -> Result<Stop, String> {
    let stop = fetch_stop(&stop_id)?;
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
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

/// Fetch a list of stops from the KVV API and persist them all.
/// Utility/admin command — not called from the main UI.
/// Returns each result as Ok(stop) or Err(message) so partial failures are visible.
#[tauri::command]
fn fetch_and_store_stops(
    state: tauri::State<DbState>,
    stop_ids: Vec<String>,
) -> Vec<Result<Stop, String>> {
    stop_ids
        .iter()
        .map(|id| {
            let stop = fetch_stop(id)?;
            let mut conn = state.0.lock().map_err(|e| e.to_string())?;
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
        })
        .collect()
}

/// Return all stops stored in the database.
/// Utility/admin command — not called from the main UI.
#[tauri::command]
fn get_stops(state: tauri::State<DbState>) -> Result<Vec<Stop>, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    list_stops(&mut conn).map_err(|e| e.to_string())
}

/// Fetch all stops within a radius (km) of a center point and persist them.
/// Returns up to `limit` stops sorted by distance from the center (nearest first).
#[tauri::command]
fn fetch_stops_near(
    state: tauri::State<DbState>,
    latitude: f64,
    longitude: f64,
    radius_km: f64,
    limit: Option<usize>,
) -> Result<Vec<Stop>, String> {
    // Approximate degrees from km
    let delta_lat = radius_km / 111.32;
    let delta_lon = radius_km / (111.32 * latitude.to_radians().cos());

    let min_lon = longitude - delta_lon;
    let max_lat = latitude + delta_lat;
    let max_lon = longitude + delta_lon;
    let min_lat = latitude - delta_lat;

    // KVV format: "lon:lat:WGS84[DD.DDDDD]"
    let bounds_lu = format!("{min_lon:.5}:{max_lat:.5}:WGS84[DD.DDDDD]");
    let bounds_rl = format!("{max_lon:.5}:{min_lat:.5}:WGS84[DD.DDDDD]");

    fetch_stops_in_bounds_inner(&state, &bounds_lu, &bounds_rl).map(|mut stops| {
        stops.sort_by(|a, b| {
            let da = haversine_km(latitude, longitude, a.latitude, a.longitude);
            let db = haversine_km(latitude, longitude, b.latitude, b.longitude);
            da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
        });
        stops.truncate(limit.unwrap_or(8));
        stops
    })
}

/// Fetch all stops within a bounding box from the KVV COORD API and persist them.
/// `bounds_lu` and `bounds_rl` are in "lon:lat:WGS84[DD.DDDDD]" format.
/// Utility/admin command — prefer `fetch_stops_near` from the UI.
#[tauri::command]
fn fetch_stops_in_bounds(
    state: tauri::State<DbState>,
    bounds_lu: String,
    bounds_rl: String,
) -> Result<Vec<Stop>, String> {
    fetch_stops_in_bounds_inner(&state, &bounds_lu, &bounds_rl)
}

fn fetch_stops_in_bounds_inner(
    state: &tauri::State<DbState>,
    bounds_lu: &str,
    bounds_rl: &str,
) -> Result<Vec<Stop>, String> {
    let url = format!(
        "{KVV_COORD_BASE}?action=XSLT_COORD_REQUEST\
&jsonp=jsonpFn1&boundingBox=\
&boundingBoxLU={bounds_lu}\
&boundingBoxRL={bounds_rl}\
&coordOutputFormat=WGS84[DD.DDDDD]&outputFormat=json&inclFilter=1&type_1=STOP"
    );

    let raw = http_client(10)?
        .get(&url)
        .send()
        .map_err(|e| e.to_string())?
        .text()
        .map_err(|e| e.to_string())?;

    // Strip JSONP wrapper: jsonpFn1({...});
    let json_str = raw
        .trim()
        .strip_prefix("jsonpFn1(")
        .and_then(|s| s.strip_suffix(");").or_else(|| s.strip_suffix(')')))
        .ok_or("unexpected JSONP format")?;

    let resp: Value = serde_json::from_str(json_str).map_err(|e| e.to_string())?;

    let pins = resp["pins"].as_array().ok_or("missing pins array")?;

    let mut stops: Vec<Stop> = Vec::with_capacity(pins.len());
    for pin in pins {
        let id = match pin["id"].as_str() {
            Some(v) => v.to_string(),
            None => continue,
        };
        // Prefer the full "Locality Name" from the STOP_NAME_WITH_PLACE attribute
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

    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    upsert_stops(&mut conn, new_stops).map_err(|e| e.to_string())?;

    Ok(stops)
}

// ── Network-stop pin commands ─────────────────────────────────────────────────

/// Pin a stop to a network. Also upserts the stop so it's always in the DB.
#[tauri::command]
fn pin_stop_to_network(
    state: tauri::State<DbState>,
    ssid: String,
    stop_id: String,
    stop_name: String,
    longitude: f64,
    latitude: f64,
) -> Result<(), String> {
    use crate::schema::{network_stops, stops};
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    // Ensure stop exists
    diesel::insert_into(stops::table)
        .values(NewStop {
            id: &stop_id,
            name: &stop_name,
            longitude,
            latitude,
        })
        .on_conflict(stops::id)
        .do_update()
        .set((
            stops::name.eq(&stop_name),
            stops::longitude.eq(longitude),
            stops::latitude.eq(latitude),
        ))
        .execute(&mut *conn)
        .map_err(|e| e.to_string())?;
    // Pin
    diesel::insert_into(network_stops::table)
        .values((
            network_stops::network_ssid.eq(&ssid),
            network_stops::stop_id.eq(&stop_id),
        ))
        .on_conflict_do_nothing()
        .execute(&mut *conn)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// Unpin a stop from a network.
#[tauri::command]
fn unpin_stop_from_network(
    state: tauri::State<DbState>,
    ssid: String,
    stop_id: String,
) -> Result<(), String> {
    use crate::schema::network_stops;
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    diesel::delete(
        network_stops::table
            .filter(network_stops::network_ssid.eq(&ssid))
            .filter(network_stops::stop_id.eq(&stop_id)),
    )
    .execute(&mut *conn)
    .map(|_| ())
    .map_err(|e| e.to_string())
}

/// Get all stops pinned to a specific network.
#[tauri::command]
fn get_network_stops(state: tauri::State<DbState>, ssid: String) -> Result<Vec<Stop>, String> {
    use crate::schema::{network_stops, stops};
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    network_stops::table
        .filter(network_stops::network_ssid.eq(&ssid))
        .inner_join(stops::table.on(stops::id.eq(network_stops::stop_id)))
        .select(stops::all_columns)
        .load::<Stop>(&mut *conn)
        .map_err(|e| e.to_string())
}

// ── Network commands ──────────────────────────────────────────────────────────

// ── Android WiFi detection ────────────────────────────────────────────────────

#[cfg(target_os = "android")]
fn android_detect_wifi() -> Option<ConnectionInfo> {
    use std::io::Read as _;
    use std::process::{Command, Stdio};

    fn normalize_ssid(raw: &str) -> Option<String> {
        let trimmed = raw.trim().trim_matches('"').trim();
        if trimmed.is_empty() {
            return None;
        }
        let lower = trimmed.to_ascii_lowercase();
        if lower == "<unknown ssid>" || lower == "unknown ssid" || lower == "n/a" {
            return None;
        }
        Some(trimmed.to_string())
    }

    /// Spawn a command with a hard 3-second wall-clock deadline.
    /// Reads at most `max_bytes` of stdout, then kills the child.
    fn run_limited(bin: &str, args: &[&str], max_bytes: usize) -> Option<String> {
        let mut child = Command::new(bin)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .ok()?;

        let deadline = std::time::Instant::now() + Duration::from_secs(3);
        let mut stdout = child.stdout.take()?;
        let mut buf = vec![0u8; max_bytes];
        let mut filled = 0;
        while filled < max_bytes && std::time::Instant::now() < deadline {
            match stdout.read(&mut buf[filled..]) {
                Ok(0) => break,
                Ok(n) => filled += n,
                Err(_) => break,
            }
        }
        drop(stdout);
        let _ = child.kill();
        let _ = child.wait();
        Some(String::from_utf8_lossy(&buf[..filled]).into_owned())
    }

    fn wifi_from(name: String) -> Option<ConnectionInfo> {
        Some(ConnectionInfo {
            name,
            conn_type: "wifi".to_string(),
        })
    }

    // 1) `cmd wifi status` — lightweight, Android 12+ (4 KB is plenty)
    if let Some(out) = run_limited("cmd", &["wifi", "status"], 4096) {
        for line in out.lines() {
            let trimmed = line.trim();
            if let Some((k, v)) = trimmed.split_once(':') {
                if k.trim().eq_ignore_ascii_case("ssid") {
                    if let Some(ssid) = normalize_ssid(v) {
                        return wifi_from(ssid);
                    }
                }
            }
        }
    }

    // 2) `getprop` — often exposes the current SSID without extra permissions
    if let Some(out) = run_limited("getprop", &["dhcp.wlan0.domain"], 256) {
        if let Some(ssid) = normalize_ssid(&out) {
            return wifi_from(ssid);
        }
    }

    // 3) `wpa_cli -i wlan0 status` — key=value output, available on many ROMs
    if let Some(out) = run_limited("wpa_cli", &["-i", "wlan0", "status"], 4096) {
        for line in out.lines() {
            if let Some(ssid) = line.strip_prefix("ssid=") {
                if let Some(name) = normalize_ssid(ssid) {
                    return wifi_from(name);
                }
            }
        }
    }

    // 4) `dumpsys wifi` — heavy; cap at 16 KB and look for "mWifiInfo" SSID field
    if let Some(out) = run_limited("dumpsys", &["wifi"], 16384) {
        for line in out.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("SSID:") {
                let end = rest.find(',').unwrap_or(rest.len());
                if let Some(ssid) = normalize_ssid(&rest[..end]) {
                    return wifi_from(ssid);
                }
            }
            if trimmed.contains("mWifiInfo") {
                if let Some(pos) = trimmed.find("SSID: ") {
                    let rest = &trimmed[pos + 6..];
                    let end = rest.find(',').unwrap_or(rest.len());
                    if let Some(ssid) = normalize_ssid(&rest[..end]) {
                        return wifi_from(ssid);
                    }
                }
            }
        }
    }

    // 5) Filesystem fallback: if wlan0 is "up", report wifi even without SSID.
    //    The app can still match networks by checking the DB for any single saved network.
    if let Ok(state) = std::fs::read_to_string("/sys/class/net/wlan0/operstate") {
        if state.trim() == "up" {
            return wifi_from("WiFi".to_string());
        }
    }

    None
}

/// Get the active WiFi or wired (ethernet) connection.
/// Returns None for loopback, mobile or unknown types.
#[tauri::command]
fn get_current_connection() -> Option<ConnectionInfo> {
    #[cfg(target_os = "android")]
    {
        return std::panic::catch_unwind(android_detect_wifi).ok().flatten();
    }

    #[cfg(not(target_os = "android"))]
    {
        let output = std::process::Command::new("nmcli")
            .args(["-t", "-f", "active,name,type", "con", "show", "--active"])
            .output()
            .ok()?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.splitn(3, ':').collect();
            if parts.len() != 3 || parts[0] != "yes" {
                continue;
            }
            let name = parts[1].trim().to_string();
            let conn_type = match parts[2].trim() {
                "802-11-wireless" => "wifi",
                "802-3-ethernet" => "ethernet",
                _ => continue,
            };
            if name.is_empty() {
                continue;
            }
            return Some(ConnectionInfo {
                name,
                conn_type: conn_type.to_string(),
            });
        }
        None
    }
}

#[derive(Serialize, Debug, Clone)]
pub struct ConnectionInfo {
    pub name: String,
    pub conn_type: String,
}

/// Check if the active connection matches a saved network.
#[tauri::command]
fn check_current_network(state: tauri::State<DbState>) -> Result<Option<Network>, String> {
    let Some(connection_info) = get_current_connection() else {
        return Ok(None);
    };
    use crate::schema::networks;
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    networks::table
        .filter(networks::ssid.eq(&connection_info.name))
        .first::<Network>(&mut *conn)
        .optional()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_networks(state: tauri::State<DbState>) -> Result<Vec<Network>, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    list_networks(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_network(state: tauri::State<DbState>, ssid: String, label: String) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    upsert_network(
        &mut conn,
        NewNetwork {
            ssid: &ssid,
            label: &label,
        },
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_network(state: tauri::State<DbState>, ssid: String) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_network(&mut conn, &ssid)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let db_path = get_db_path(app.handle());
            let conn = establish_connection(&db_path);
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_and_store_stop,
            fetch_and_store_stops,
            fetch_stops_in_bounds,
            fetch_stops_near,
            get_stops,
            fetch_departures,
            search_stops,
            search_stops_db,
            fetch_trip_stopseq,
            get_current_connection,
            check_current_network,
            get_networks,
            add_network,
            remove_network,
            pin_stop_to_network,
            unpin_stop_from_network,
            get_network_stops
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
