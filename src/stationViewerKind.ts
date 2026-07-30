export type StationViewerKind = "table" | "compact" | "board";

export const DEFAULT_STATION_VIEWER_KIND: StationViewerKind = "table";

export const STATION_VIEWER_KINDS: readonly StationViewerKind[] = [
  "table",
  "compact",
  "board",
] as const;

export function isStationViewerKind(value: unknown): value is StationViewerKind {
  return value === "table" || value === "compact" || value === "board";
}

export function normalizeStationViewerKind(value: unknown): StationViewerKind {
  return isStationViewerKind(value) ? value : DEFAULT_STATION_VIEWER_KIND;
}
