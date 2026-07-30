import type { Departure } from "../../types";
import type { StationViewerKind } from "../../stationViewerKind";

export type { StationViewerKind };
export {
  DEFAULT_STATION_VIEWER_KIND,
  STATION_VIEWER_KINDS,
  isStationViewerKind,
  normalizeStationViewerKind,
} from "../../stationViewerKind";

export type StationViewerProps = {
  stopId: string;
  departures: Departure[];
  routeLoadingId: string | null;
  onDepartureClick: (dep: Departure) => void;
};
