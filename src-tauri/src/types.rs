use serde::Serialize;

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

#[derive(Serialize, Debug, Clone)]
pub struct ConnectionInfo {
    pub name: String,
    pub conn_type: String,
}
