import {
  DEFAULT_STATION_VIEWER_KIND,
  normalizeStationViewerKind,
  type StationViewerKind,
} from "./stationViewerKind";

export type { StationViewerKind };

export interface Stop {
  id: string;
  name: string;
  longitude: number;
  latitude: number;
}

export interface ManualCoords {
  lat: number;
  lon: number;
}

export interface DisplaySettings {
  nearbyStopsLimit: number;
  timeWindowMinutes: number;
  stationViewerKind: StationViewerKind;
}

const STARRED_KEY = "ka_starred_stops";
const COORDS_KEY = "ka_manual_coords";
const DISPLAY_KEY = "ka_display_settings";

const DEFAULT_DISPLAY: DisplaySettings = {
  nearbyStopsLimit: 8,
  timeWindowMinutes: 60,
  stationViewerKind: DEFAULT_STATION_VIEWER_KIND,
};

export function loadStarred(): Stop[] {
  try { return JSON.parse(localStorage.getItem(STARRED_KEY) ?? "[]"); }
  catch { return []; }
}

export function saveStarred(stops: Stop[]): void {
  localStorage.setItem(STARRED_KEY, JSON.stringify(stops));
}

export function loadManualCoords(): ManualCoords {
  try {
    const raw = localStorage.getItem(COORDS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { lat: 49.009, lon: 8.404 };
}

export function saveManualCoords(coords: ManualCoords): void {
  localStorage.setItem(COORDS_KEY, JSON.stringify(coords));
}

export function loadDisplaySettings(): DisplaySettings {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DisplaySettings>;
      return {
        ...DEFAULT_DISPLAY,
        ...parsed,
        stationViewerKind: normalizeStationViewerKind(parsed.stationViewerKind),
      };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_DISPLAY };
}

export function saveDisplaySettings(settings: DisplaySettings): void {
  const normalized: DisplaySettings = {
    ...settings,
    stationViewerKind: normalizeStationViewerKind(settings.stationViewerKind),
  };
  localStorage.setItem(DISPLAY_KEY, JSON.stringify(normalized));
}
