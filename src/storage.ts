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

const STARRED_KEY = "ka_starred_stops";
const COORDS_KEY  = "ka_manual_coords";

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
