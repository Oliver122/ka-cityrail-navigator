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
}

const STARRED_KEY = "ka_starred_stops";
const COORDS_KEY  = "ka_manual_coords";
const DISPLAY_KEY = "ka_display_settings";
const MANUAL_NETWORK_KEY = "ka_manual_network_ssid";

const DEFAULT_DISPLAY: DisplaySettings = {
  nearbyStopsLimit: 8,
  timeWindowMinutes: 60,
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
    if (raw) return { ...DEFAULT_DISPLAY, ...JSON.parse(raw) };
  } catch { /* ignore */ }
  return DEFAULT_DISPLAY;
}

export function saveDisplaySettings(settings: DisplaySettings): void {
  localStorage.setItem(DISPLAY_KEY, JSON.stringify(settings));
}

export function loadManualNetworkSsid(): string | null {
  const raw = localStorage.getItem(MANUAL_NETWORK_KEY);
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function saveManualNetworkSsid(ssid: string | null): void {
  if (!ssid || !ssid.trim()) {
    localStorage.removeItem(MANUAL_NETWORK_KEY);
    return;
  }
  localStorage.setItem(MANUAL_NETWORK_KEY, ssid.trim());
}
