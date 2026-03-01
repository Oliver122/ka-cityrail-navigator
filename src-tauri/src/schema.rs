// @generated automatically by Diesel CLI.

diesel::table! {
    stops (id) {
        id -> Text,
        name -> Text,
        longitude -> Double,
        latitude -> Double,
    }
}

diesel::table! {
    networks (ssid) {
        ssid -> Text,
        label -> Text,
    }
}

diesel::table! {
    network_stops (network_ssid, stop_id) {
        network_ssid -> Text,
        stop_id      -> Text,
    }
}

diesel::joinable!(network_stops -> networks (network_ssid));
diesel::joinable!(network_stops -> stops (stop_id));
diesel::allow_tables_to_appear_in_same_query!(stops, networks, network_stops);

