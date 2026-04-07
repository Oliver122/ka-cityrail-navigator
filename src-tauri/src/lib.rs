mod db;
mod schema;

use std::sync::Mutex;
use db::{establish_connection, list_stops, upsert_stop, upsert_stops, NewStop, Stop,
         list_networks, upsert_network, delete_network, Network, NewNetwork};
use diesel::sqlite::SqliteConnection;
use serde::Serialize;
use diesel::prelude::*;
use serde_json::Value;
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
    pub line: String,
    pub line_type: String,
    pub mot_type: String,
    pub direction: String,
    pub platform: String,
    pub planned_time: String,
    pub real_time: String,
    pub delay_minutes: i64,
    pub countdown: i64,
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

// ── KVV DM helper ──────────────────────────────────────────────────────────────

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

fn get_db_path(app: &tauri::AppHandle) -> String {
    // Use Tauri's app data directory - works correctly on all platforms including Android
    let app_data_dir = app.path().app_data_dir()
        .expect("Failed to get app data directory");
    std::fs::create_dir_all(&app_data_dir).ok();
    app_data_dir.join("stops.db").to_string_lossy().to_string()
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

    let resp: Value = reqwest::blocking::get(&url)
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
    let longitude: f64 = parts.next().ok_or("missing lon")?.parse().map_err(|e: std::num::ParseFloatError| e.to_string())?;
    let latitude: f64 = parts.next().ok_or("missing lat")?.parse().map_err(|e: std::num::ParseFloatError| e.to_string())?;

    Ok(Stop { id, name, longitude, latitude })
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

    let resp: Value = reqwest::blocking::get(&url)
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
        let rdt = if d["realDateTime"].is_object() { &d["realDateTime"] } else { dt };
        let platform = match &d["platform"] {
            Value::String(s) => s.clone(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        departures.push(Departure {
            stop_name: d["stopName"].as_str().unwrap_or("").to_string(),
            line: sl["number"].as_str().unwrap_or("").to_string(),
            line_type: sl["name"].as_str().unwrap_or("").to_string(),
            mot_type: sl["motType"].as_str().unwrap_or("").to_string(),
            direction: sl["direction"].as_str().unwrap_or("").to_string(),
            platform,
            planned_time: parse_time_field(&dt["hour"], &dt["minute"]),
            real_time: parse_time_field(&rdt["hour"], &rdt["minute"]),
            delay_minutes: json_to_i64(&sl["delay"]),
            countdown: json_to_i64(&d["countdown"]),
        });
    }
    Ok(departures)
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

    let resp: Value = reqwest::blocking::get(&url)
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
        if !p.is_object() { continue; }
        let name = match p["name"].as_str() { Some(s) => s.to_string(), None => continue };
        let id   = match p["ref"]["id"].as_str() { Some(s) => s.to_string(), None => continue };
        let coords = match p["ref"]["coords"].as_str() { Some(s) => s, None => continue };
        let mut parts = coords.split(',');
        let longitude: f64 = match parts.next().and_then(|s| s.parse().ok()) { Some(v) => v, None => continue };
        let latitude:  f64 = match parts.next().and_then(|s| s.parse().ok()) { Some(v) => v, None => continue };
        stops.push(Stop { id, name, longitude, latitude });
    }
    Ok(stops)
}


/// Search the local DB for stops whose name contains the query string.
#[tauri::command]
fn search_stops_db(
    state: tauri::State<DbState>,
    query: String,
) -> Result<Vec<Stop>, String> {
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
fn fetch_and_store_stop(
    state: tauri::State<DbState>,
    stop_id: String,
) -> Result<Stop, String> {
    let stop = fetch_stop(&stop_id)?;
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    upsert_stop(&mut conn, NewStop { id: &stop.id, name: &stop.name, longitude: stop.longitude, latitude: stop.latitude })
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
            upsert_stop(&mut conn, NewStop { id: &stop.id, name: &stop.name, longitude: stop.longitude, latitude: stop.latitude })
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

fn fetch_stops_in_bounds_inner(state: &tauri::State<DbState>, bounds_lu: &str, bounds_rl: &str) -> Result<Vec<Stop>, String> {
    let url = format!(
        "{KVV_COORD_BASE}?action=XSLT_COORD_REQUEST\
&jsonp=jsonpFn1&boundingBox=\
&boundingBoxLU={bounds_lu}\
&boundingBoxRL={bounds_rl}\
&coordOutputFormat=WGS84[DD.DDDDD]&outputFormat=json&inclFilter=1&type_1=STOP"
    );

    let raw = reqwest::blocking::get(&url)
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
                attrs.iter().find(|a| a["name"] == "STOP_NAME_WITH_PLACE")
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

        stops.push(Stop { id, name, longitude, latitude });
    }

    let new_stops: Vec<NewStop> = stops
        .iter()
        .map(|s| NewStop { id: &s.id, name: &s.name, longitude: s.longitude, latitude: s.latitude })
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
    use crate::schema::{stops, network_stops};
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    // Ensure stop exists
    diesel::insert_into(stops::table)
        .values(NewStop { id: &stop_id, name: &stop_name, longitude, latitude })
        .on_conflict(stops::id)
        .do_update()
        .set((stops::name.eq(&stop_name), stops::longitude.eq(longitude), stops::latitude.eq(latitude)))
        .execute(&mut *conn)
        .map_err(|e| e.to_string())?;
    // Pin
    diesel::insert_into(network_stops::table)
        .values((network_stops::network_ssid.eq(&ssid), network_stops::stop_id.eq(&stop_id)))
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
fn get_network_stops(
    state: tauri::State<DbState>,
    ssid: String,
) -> Result<Vec<Stop>, String> {
    use crate::schema::{stops, network_stops};
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    network_stops::table
        .filter(network_stops::network_ssid.eq(&ssid))
        .inner_join(stops::table.on(stops::id.eq(network_stops::stop_id)))
        .select(stops::all_columns)
        .load::<Stop>(&mut *conn)
        .map_err(|e| e.to_string())
}

// ── Network commands ──────────────────────────────────────────────────────────

/// Get the active WiFi or wired (ethernet) connection.
/// Returns None for loopback, mobile or unknown types.
/// On Android, returns None as nmcli is not available.
#[tauri::command]
fn get_current_connection() -> Option<ConnectionInfo> {
    // nmcli is only available on Linux desktop, not on Android
    #[cfg(target_os = "android")]
    {
        return None;
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
            if parts.len() != 3 || parts[0] != "yes" { continue; }
            let name = parts[1].trim().to_string();
            let conn_type = match parts[2].trim() {
                "802-11-wireless" => "wifi",
                "802-3-ethernet"  => "ethernet",
                _ => continue,
            };
            if name.is_empty() { continue; }
            return Some(ConnectionInfo { name, conn_type: conn_type.to_string() });
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
    let Some(connection_info) = get_current_connection() else { return Ok(None) };
    use crate::schema::networks;
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    networks::table
        .filter(networks::ssid.eq(&connection_info.name))
        .first::<Network>(&mut *conn)
        .optional()
        .map_err(|e| e.to_string())
}

/// Whether runtime network detection is supported on this platform.
#[tauri::command]
fn is_network_detection_available() -> bool {
    #[cfg(target_os = "android")]
    {
        false
    }
    #[cfg(not(target_os = "android"))]
    {
        true
    }
}

#[tauri::command]
fn get_networks(state: tauri::State<DbState>) -> Result<Vec<Network>, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    list_networks(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
fn add_network(state: tauri::State<DbState>, ssid: String, label: String) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    upsert_network(&mut conn, NewNetwork { ssid: &ssid, label: &label })
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn remove_network(state: tauri::State<DbState>, ssid: String) -> Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_network(&mut conn, &ssid).map(|_| ()).map_err(|e| e.to_string())
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Initialize database using Tauri's app data directory
            // This works correctly on Android unlike dirs::data_local_dir()
            let db_path = get_db_path(app.handle());
            let conn = establish_connection(&db_path);
            app.manage(DbState(Mutex::new(conn)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_and_store_stop, fetch_and_store_stops, fetch_stops_in_bounds,
            fetch_stops_near, get_stops, fetch_departures, search_stops, search_stops_db,
            get_current_connection, check_current_network, get_networks, add_network, remove_network,
            pin_stop_to_network, unpin_stop_from_network, get_network_stops, is_network_detection_available
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
