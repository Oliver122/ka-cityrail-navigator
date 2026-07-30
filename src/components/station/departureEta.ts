import type { Departure } from "../../types";
import { formatCountdown } from "../../utils/time";

export function departureRowId(stopId: string, dep: Departure): string {
  return `${stopId}-${dep.line}-${dep.planned_time}`;
}

/** Shared ETA / delay / loading text for all station viewers. */
export function departureEtaLabel(
  dep: Departure,
  stopId: string,
  routeLoadingId: string | null,
): { text: string; delayed: boolean } {
  if (routeLoadingId === departureRowId(stopId, dep)) {
    return { text: "…", delayed: false };
  }
  if (dep.delay_minutes > 0) {
    return { text: `+${dep.delay_minutes} min`, delayed: true };
  }
  return {
    text: formatCountdown(dep.countdown, dep.real_time).text,
    delayed: false,
  };
}
