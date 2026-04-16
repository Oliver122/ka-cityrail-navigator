use diesel::prelude::*;

use crate::db::{
    delete_network, list_networks, upsert_network, Network, NewNetwork, NewStop, Stop,
};
use crate::types::ConnectionInfo;
use crate::AppState;

// ── Android WiFi detection ────────────────────────────────────────────────────

#[cfg(target_os = "android")]
fn android_detect_wifi() -> Option<ConnectionInfo> {
    use std::io::Read as _;
    use std::process::{Command, Stdio};
    use std::time::Duration;

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

    if let Some(out) = run_limited("getprop", &["dhcp.wlan0.domain"], 256) {
        if let Some(ssid) = normalize_ssid(&out) {
            return wifi_from(ssid);
        }
    }

    if let Some(out) = run_limited("wpa_cli", &["-i", "wlan0", "status"], 4096) {
        for line in out.lines() {
            if let Some(ssid) = line.strip_prefix("ssid=") {
                if let Some(name) = normalize_ssid(ssid) {
                    return wifi_from(name);
                }
            }
        }
    }

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

    if let Ok(state) = std::fs::read_to_string("/sys/class/net/wlan0/operstate") {
        if state.trim() == "up" {
            return wifi_from("WiFi".to_string());
        }
    }

    None
}

// ── Connection commands ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_current_connection() -> Option<ConnectionInfo> {
    #[cfg(target_os = "android")]
    {
        return std::panic::catch_unwind(android_detect_wifi)
            .ok()
            .flatten();
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
pub fn get_network_stops(
    state: tauri::State<AppState>,
    ssid: String,
) -> Result<Vec<Stop>, String> {
    use crate::schema::{network_stops, stops};
    let mut conn = state.db.lock().map_err(|e| e.to_string())?;
    network_stops::table
        .filter(network_stops::network_ssid.eq(&ssid))
        .inner_join(stops::table.on(stops::id.eq(network_stops::stop_id)))
        .select(stops::all_columns)
        .load::<Stop>(&mut *conn)
        .map_err(|e| e.to_string())
}
