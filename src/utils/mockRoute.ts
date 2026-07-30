import type { Departure, RouteStop } from "../types";

/** Fallback route stops when KVV stopseq is missing or fails. */
export function createMockRouteStops(departure: Departure, stopName: string): RouteStop[] {
  return [
    { id: "1", name: "Hauptbahnhof", arrivalTime: departure.planned_time, status: "passed" },
    {
      id: "2",
      name: stopName,
      arrivalTime: departure.real_time,
      status: "current",
      delayMinutes: departure.delay_minutes,
    },
    { id: "3", name: "Marktplatz", arrivalTime: "", status: "upcoming" },
    { id: "4", name: departure.direction, arrivalTime: "", status: "upcoming" },
  ];
}
