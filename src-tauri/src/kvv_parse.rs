use serde_json::Value;

use crate::helpers::{
    attr_value, json_to_i64, parse_time_field, shorten_line_number, trim_path_to_last_stop,
    trip_code_from_realtime_trip_id,
};
use crate::types::{Departure, TripRouteStop, TripStopSeqResponse};

/// Map a KVV `departureList` JSON array into domain `Departure` rows.
pub fn parse_departure_list(resp: &Value, stop_id: &str) -> Vec<Departure> {
    let Some(list) = resp["departureList"].as_array() else {
        return vec![];
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
            stop_id: d["stopID"].as_str().unwrap_or(stop_id).to_string(),
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
    departures
}

/// Map a KVV stopseq JSONP body into `TripStopSeqResponse`.
pub fn parse_trip_stopseq(
    resp: &Value,
    fallback_trip_code: &str,
) -> Result<TripStopSeqResponse, String> {
    let mode = &resp["stopSeqCoords"]["params"]["mode"];
    let trip_code_value = mode["diva"]["tripCode"]
        .as_str()
        .map(|v| v.to_string())
        .or_else(|| mode["diva"]["tripCode"].as_i64().map(|v| v.to_string()))
        .unwrap_or_else(|| fallback_trip_code.to_string());

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

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    fn fixture(name: &str) -> Value {
        let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        path.push("tests/fixtures");
        path.push(name);
        let raw = fs::read_to_string(&path).unwrap_or_else(|e| panic!("read {path:?}: {e}"));
        serde_json::from_str(&raw).expect("parse fixture json")
    }

    #[test]
    fn parse_departure_list_sample() {
        let resp = fixture("departure_list_sample.json");
        let deps = parse_departure_list(&resp, "fallback-stop");
        assert!(!deps.is_empty());
        assert_eq!(deps[0].line, "S1");
        assert_eq!(deps[0].planned_time, "14:30");
        assert_eq!(deps[0].trip_code, "42");
        assert_eq!(deps[0].stop_id, "de:8212:1");
    }

    #[test]
    fn parse_trip_stopseq_sample_trims_path() {
        let resp = fixture("trip_stopseq_sample.json");
        let route = parse_trip_stopseq(&resp, "fallback").unwrap();
        assert_eq!(route.route_stops.len(), 2);
        assert_eq!(route.path, "8.4,49.0 8.5,49.1");
        assert_eq!(route.destination, "Marktplatz");
        assert_eq!(route.trip_code, "99");
    }
}
