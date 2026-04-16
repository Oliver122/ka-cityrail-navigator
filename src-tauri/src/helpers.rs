use serde_json::Value;

use crate::types::TripRouteStop;

pub fn haversine_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    const R: f64 = 6371.0;
    let dlat = (lat2 - lat1).to_radians();
    let dlon = (lon2 - lon1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlon / 2.0).sin().powi(2);
    R * 2.0 * a.sqrt().asin()
}

/// Shorten verbose line numbers like "ICE 372 InterCityExpress" → "ICE 372".
pub fn shorten_line_number(raw: &str) -> String {
    const PREFIXES: [&str; 10] = [
        "ICE", "IC", "EC", "TGV", "RJX", "RJ", "EN", "NJ", "FLX", "THA",
    ];
    for pfx in PREFIXES {
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

pub fn parse_time_field(h: &Value, m: &Value) -> String {
    let hh = h.as_str().unwrap_or("0");
    let mm = m.as_str().unwrap_or("0");
    format!("{hh:0>2}:{mm:0>2}")
}

pub fn json_to_i64(v: &Value) -> i64 {
    v.as_str()
        .and_then(|s| s.parse().ok())
        .or_else(|| v.as_i64())
        .unwrap_or(0)
}

pub fn attr_value(obj: &Value, name: &str) -> Option<String> {
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
pub fn trip_code_from_realtime_trip_id(id: &str) -> Option<String> {
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

/// Trim path coordinates to the segment ending at the last route stop.
/// The KVV API sometimes appends a backtracking segment past the terminus.
pub fn trim_path_to_last_stop(raw_path: &str, stops: &[TripRouteStop]) -> String {
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
