import type { ComponentType } from "react";
import StationDeparturesBoard from "./StationDeparturesBoard";
import StationDeparturesCompact from "./StationDeparturesCompact";
import StationDeparturesTable from "./StationDeparturesTable";
import {
  DEFAULT_STATION_VIEWER_KIND,
  type StationViewerKind,
  type StationViewerProps,
  normalizeStationViewerKind,
} from "./StationViewerTypes";

export const STATION_VIEWERS: Record<
  StationViewerKind,
  ComponentType<StationViewerProps>
> = {
  table: StationDeparturesTable,
  compact: StationDeparturesCompact,
  board: StationDeparturesBoard,
};

export function getStationViewer(
  kind: StationViewerKind | string | null | undefined,
): ComponentType<StationViewerProps> {
  const normalized = normalizeStationViewerKind(kind);
  return STATION_VIEWERS[normalized] ?? STATION_VIEWERS[DEFAULT_STATION_VIEWER_KIND];
}
