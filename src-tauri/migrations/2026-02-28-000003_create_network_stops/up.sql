CREATE TABLE IF NOT EXISTS network_stops (
    network_ssid TEXT NOT NULL REFERENCES networks(ssid) ON DELETE CASCADE,
    stop_id      TEXT NOT NULL REFERENCES stops(id)    ON DELETE CASCADE,
    PRIMARY KEY (network_ssid, stop_id)
);
