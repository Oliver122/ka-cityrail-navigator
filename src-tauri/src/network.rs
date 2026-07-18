use diesel::prelude::*;

use crate::db::{
    delete_network, list_networks, upsert_network, Network, NewNetwork, NewStop, Stop,
};
use crate::types::ConnectionInfo;
use crate::AppState;

// ── Android WiFi detection ────────────────────────────────────────────────────

#[cfg(target_os = "android")]
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

/// Query the connected WiFi SSID through the Android `WifiManager` API via JNI.
///
/// Shell tools (`cmd wifi`, `dumpsys`, `wpa_cli`) are not accessible to
/// untrusted apps, so this is the only reliable in-app way to read the SSID.
/// Requires `ACCESS_WIFI_STATE` in the manifest plus runtime location
/// permission (already requested by the geolocation plugin); otherwise
/// Android reports `<unknown ssid>` and we return `None`.
#[cfg(target_os = "android")]
fn android_wifi_ssid_via_jni() -> Option<String> {
    use jni::objects::{JObject, JString, JValue};

    // Clear any pending Java exception so subsequent JNI calls stay valid.
    fn ok_or_clear<T>(env: &mut jni::JNIEnv, res: jni::errors::Result<T>) -> Option<T> {
        match res {
            Ok(v) => Some(v),
            Err(_) => {
                let _ = env.exception_clear();
                None
            }
        }
    }

    let ctx = ndk_context::android_context();
    let vm = unsafe { jni::JavaVM::from_raw(ctx.vm().cast()) }.ok()?;
    let activity = unsafe { JObject::from_raw(ctx.context().cast()) };
    let mut env = vm.attach_current_thread().ok()?;

    let app_context = {
        let res = env.call_method(
            &activity,
            "getApplicationContext",
            "()Landroid/content/Context;",
            &[],
        );
        ok_or_clear(&mut env, res)?.l().ok()?
    };

    let service_name = env.new_string("wifi").ok()?;
    let wifi_manager = {
        let res = env.call_method(
            &app_context,
            "getSystemService",
            "(Ljava/lang/String;)Ljava/lang/Object;",
            &[JValue::Object(&service_name)],
        );
        ok_or_clear(&mut env, res)?.l().ok()?
    };
    if wifi_manager.is_null() {
        return None;
    }

    let wifi_info = {
        let res = env.call_method(
            &wifi_manager,
            "getConnectionInfo",
            "()Landroid/net/wifi/WifiInfo;",
            &[],
        );
        ok_or_clear(&mut env, res)?.l().ok()?
    };
    if wifi_info.is_null() {
        return None;
    }

    let ssid_obj = {
        let res = env.call_method(&wifi_info, "getSSID", "()Ljava/lang/String;", &[]);
        ok_or_clear(&mut env, res)?.l().ok()?
    };
    if ssid_obj.is_null() {
        return None;
    }

    let ssid: String = env.get_string(&JString::from(ssid_obj)).ok()?.into();
    normalize_ssid(&ssid)
}

#[cfg(target_os = "android")]
fn android_detect_wifi() -> Option<ConnectionInfo> {
    if let Some(ssid) = android_wifi_ssid_via_jni() {
        return Some(ConnectionInfo {
            name: ssid,
            conn_type: "wifi".to_string(),
        });
    }

    // Fallback: interface is up but the SSID is not readable
    // (permission denied or location services disabled).
    if let Ok(state) = std::fs::read_to_string("/sys/class/net/wlan0/operstate") {
        if state.trim() == "up" {
            return Some(ConnectionInfo {
                name: "WiFi".to_string(),
                conn_type: "wifi".to_string(),
            });
        }
    }

    None
}

// ── Connection commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_current_connection() -> Option<ConnectionInfo> {
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

#[tauri::command]
pub fn check_current_network(state: tauri::State<AppState>) -> Result<Option<Network>, String> {
    let Some(connection_info) = get_current_connection() else {
        return Ok(None);
    };
    use crate::schema::networks;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    networks::table
        .filter(networks::ssid.eq(&connection_info.name))
        .first::<Network>(&mut *conn)
        .optional()
        .map_err(|e| e.to_string())
}

// ── Network CRUD commands ─────────────────────────────────────────────────────

#[tauri::command]
pub fn get_networks(state: tauri::State<AppState>) -> Result<Vec<Network>, String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    list_networks(&mut conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn add_network(
    state: tauri::State<AppState>,
    ssid: String,
    label: String,
) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
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
pub fn remove_network(state: tauri::State<AppState>, ssid: String) -> Result<(), String> {
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    delete_network(&mut conn, &ssid)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

// ── Network-stop pin commands ─────────────────────────────────────────────────

#[tauri::command]
pub fn pin_stop_to_network(
    state: tauri::State<AppState>,
    ssid: String,
    stop_id: String,
    stop_name: String,
    longitude: f64,
    latitude: f64,
) -> Result<(), String> {
    use crate::schema::{network_stops, stops};
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
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

#[tauri::command]
pub fn unpin_stop_from_network(
    state: tauri::State<AppState>,
    ssid: String,
    stop_id: String,
) -> Result<(), String> {
    use crate::schema::network_stops;
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    diesel::delete(
        network_stops::table
            .filter(network_stops::network_ssid.eq(&ssid))
            .filter(network_stops::stop_id.eq(&stop_id)),
    )
    .execute(&mut *conn)
    .map(|_| ())
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_network_stops(state: tauri::State<AppState>, ssid: String) -> Result<Vec<Stop>, String> {
    use crate::schema::{network_stops, stops};
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    network_stops::table
        .filter(network_stops::network_ssid.eq(&ssid))
        .inner_join(stops::table.on(stops::id.eq(network_stops::stop_id)))
        .select(stops::all_columns)
        .load::<Stop>(&mut *conn)
        .map_err(|e| e.to_string())
}
