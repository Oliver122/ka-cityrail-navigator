// Shared types used across App, Settings, and details screens

export interface ConnectionInfo {
  name: string;
  conn_type: "wifi" | "ethernet";
}

export interface NetworkInfo {
  ssid: string;
  label: string;
}

/** Departure row from Tauri `fetch_departures`. */
export interface Departure {
  stop_name: string;
  stop_id: string;
  line: string;
  line_type: string;
  mot_type: string;
  direction: string;
  platform: string;
  planned_time: string;
  real_time: string;
  delay_minutes: number;
  countdown: number;
  trip_code: string;
  line_stateless: string;
  realtime_trip_id: string;
  avms_trip_id: string;
  service_date: string;
  service_time: string;
}

/** Stop on a trip from Tauri `fetch_trip_stopseq`. */
export interface TripRouteStop {
  id: string;
  name: string;
  platform: string;
  arrival_time: string;
  departure_time: string;
  longitude?: number;
  latitude?: number;
}

export interface TripStopSeqResponse {
  trip_code: string;
  line_stateless: string;
  line_name: string;
  line_number: string;
  destination: string;
  path: string;
  route_stops: TripRouteStop[];
}

// Route progress for Departure Details screen
export interface RouteStop {
  id: string;
  name: string;
  arrivalTime?: string;
  departureTime?: string;
  platform?: string;
  longitude?: number;
  latitude?: number;
  status: "passed" | "current" | "upcoming";
  delayMinutes?: number;
}

export interface DepartureDetail {
  id: string;
  line: string;
  lineType: string;
  motType: string;
  direction: string;
  platform: string;
  plannedTime: string;
  realTime: string;
  delayMinutes: number;
  countdown: number;
  stopName: string;
  tripCode?: string;
  realtimeTripId?: string;
  lineStateless?: string;
  routePath?: string;
  routeStops: RouteStop[];
  disruption?: string;
}

// Page navigation
export type AppPage = "departures" | "details" | "settings";
