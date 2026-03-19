// Shared types used in both App.tsx and Settings.tsx

export interface ConnectionInfo {
  name: string;
  conn_type: "wifi" | "ethernet";
}

// Route progress for Departure Details screen
export interface RouteStop {
  id: string;
  name: string;
  arrivalTime?: string;
  departureTime?: string;
  platform?: string;
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
  routeStops: RouteStop[];
  disruption?: string;
}

// Page navigation
export type AppPage = "departures" | "details" | "settings";
