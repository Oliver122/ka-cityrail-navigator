import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentPosition, requestPermissions } from "@tauri-apps/plugin-geolocation";
import { Stop, ManualCoords, loadStarred, saveStarred, loadManualCoords } from "./storage";
import { ConnectionInfo } from "./types";
import Settings from "./Settings";
import "./App.css";

interface NetworkInfo {
  ssid: string;
  label: string;
}

function ConnectionIcon({ type }: { type: "wifi" | "ethernet" }) {
  if (type === "ethernet") return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="2" y="8" width="4" height="8" rx="1"/>
      <rect x="10" y="8" width="4" height="8" rx="1"/>
      <rect x="18" y="8" width="4" height="8" rx="1"/>
      <path d="M4 12h4M12 12h4M4 4h16v4H4zM4 16h4v4H4zM10 16h4v4h-4zM18 16h4v4h-4z"/>
    </svg>
  );
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M1.5 8.5a16.5 16.5 0 0 1 21 0M5 12.5a12 12 0 0 1 14 0M8.5 16.5a7.5 7.5 0 0 1 7 0M12 21h.01"/>
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Departure {
  stop_name: string;
  line: string;
  line_type: string;
  mot_type: string;
  direction: string;
  platform: string;
  planned_time: string;
  real_time: string;
  delay_minutes: number;
  countdown: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** MoT type codes from the KVV API mapped to brand colours. */
const MOT_COLORS: Record<string, string> = {
  "1": "#009060", // S-Bahn
  "2": "#003d8f", // Stadtbahn / U-Bahn
  "4": "#cc0000", // Tram
  "5": "#0066bb", // Bus
};
const MOT_COLOR_DEFAULT = "#555";

/** When countdown exceeds this value (minutes) show real_time instead of "N min". */
const MAX_COUNTDOWN_DISPLAY_MIN = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dlat = (lat2 - lat1) * Math.PI / 180;
  const dlon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dlat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dlon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function formatDist(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function motColor(motType: string): string {
  return MOT_COLORS[motType] ?? MOT_COLOR_DEFAULT;
}

function DelayBadge({ delay }: { delay: number }) {
  if (delay === 0) return <span className="on-time">pünktlich</span>;
  if (delay > 0) return <span className="delayed">+{delay}</span>;
  return <span className="early">{delay}</span>;
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [page, setPage] = useState<"main" | "settings">("main");
  const [nearbyStops, setNearbyStops] = useState<Stop[]>([]);
  const [starredStops, setStarredStops] = useState<Stop[]>(loadStarred);
  const [manualCoords, setManualCoords] = useState<ManualCoords>(loadManualCoords);
  const [departures, setDepartures] = useState<Record<string, Departure[]>>({});
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [status, setStatus] = useState("Standort wird ermittelt…");
  const [error, setError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const toggleStar = useCallback((stop: Stop) => {
    setStarredStops((prev) => {
      const next = prev.some((s) => s.id === stop.id)
        ? prev.filter((s) => s.id !== stop.id)
        : [...prev, stop];
      saveStarred(next);
      return next;
    });
  }, []);

  const handleStarredChange = useCallback((stops: Stop[]) => {
    setStarredStops(stops);
  }, []);

  const handleCoordsChange = useCallback((coords: ManualCoords) => {
    setManualCoords(coords);
  }, []);

  const loadFrom = useCallback(async (latitude: number, longitude: number) => {
    setUserLocation({ lat: latitude, lon: longitude });
    setError(null);
    setStatus(`Standort: ${latitude.toFixed(4)}, ${longitude.toFixed(4)} – Haltestellen werden geladen…`);
    try {
      const nearby = await invoke<Stop[]>("fetch_stops_near", {
        latitude, longitude, radiusKm: 1.5, limit: 8,
      });
      setNearbyStops(nearby);
      setStatus(`${nearby.length} Haltestellen in der Nähe`);

      // Also load departures for starred stops not already in the nearby list
      const starred = loadStarred();
      const extraStarred = starred.filter((s) => !nearby.some((n) => n.id === s.id));
      const all = [...nearby, ...extraStarred];

      const results = await Promise.all(
        all.map((s) =>
          invoke<Departure[]>("fetch_departures", { stopId: s.id })
            .then((deps) => [s.id, deps] as [string, Departure[]])
            .catch(() => [s.id, []] as [string, Departure[]])
        )
      );
      setDepartures(Object.fromEntries(results));
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const load = useCallback(() => {
    setRefreshing(true);
    setError(null);
    (async () => {
      try {
        const perms = await requestPermissions(["location"]);
        if (perms.location !== "granted") {
          const saved = loadManualCoords();
          setManualMode(true);
          setStatus(`GPS verweigert – verwende gespeicherte Position (${saved.lat}, ${saved.lon})`);
          await loadFrom(saved.lat, saved.lon);
          setRefreshing(false);
          return;
        }
        setStatus("Standort wird ermittelt…");
        const pos = await getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
        setManualMode(false);
        await loadFrom(pos.coords.latitude, pos.coords.longitude);
      } catch (e) {
        // GPS failed — silently fall back to saved manual coords
        const saved = loadManualCoords();
        setManualMode(true);
        setStatus(`GPS nicht verfügbar – verwende gespeicherte Position (${saved.lat}, ${saved.lon})`);
        await loadFrom(saved.lat, saved.lon);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [loadFrom]);

  const [collapsedStops, setCollapsedStops] = useState<Set<string>>(new Set());
  const [knownNetwork, setKnownNetwork] = useState<NetworkInfo | null>(null);
  const [connType, setConnType] = useState<"wifi" | "ethernet">("wifi");
  const [networkStops, setNetworkStops] = useState<Stop[]>([]);

  const toggleNetworkPin = useCallback(async (stop: Stop) => {
    if (!knownNetwork) return;
    const isPinned = networkStops.some((s) => s.id === stop.id);
    if (isPinned) {
      await invoke("unpin_stop_from_network", { ssid: knownNetwork.ssid, stopId: stop.id });
      setNetworkStops((prev) => prev.filter((s) => s.id !== stop.id));
    } else {
      await invoke("pin_stop_to_network", {
        ssid: knownNetwork.ssid,
        stopId: stop.id,
        stopName: stop.name,
        longitude: stop.longitude,
        latitude: stop.latitude,
      });
      setNetworkStops((prev) => [...prev, stop]);
    }
  }, [knownNetwork, networkStops]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedStops((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  // Poll network status every 15 seconds
  useEffect(() => {
    const check = async () => {
      try {
        const [net, conn] = await Promise.all([
          invoke<NetworkInfo | null>("check_current_network"),
          invoke<ConnectionInfo | null>("get_current_connection"),
        ]);
        setKnownNetwork(net);
        if (conn) setConnType(conn.conn_type);
        if (net) {
          const ns = await invoke<Stop[]>("get_network_stops", { ssid: net.ssid });
          setNetworkStops(ns);
        } else {
          setNetworkStops([]);
        }
      } catch { setKnownNetwork(null); setNetworkStops([]); }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  const sortByDist = (arr: Stop[]) =>
    userLocation
      ? [...arr].sort((a, b) =>
          haversineKm(userLocation.lat, userLocation.lon, a.latitude, a.longitude) -
          haversineKm(userLocation.lat, userLocation.lon, b.latitude, b.longitude)
        )
      : arr;

  // Build display list: network-pinned first, then starred, then nearby (deduped)
  const networkPinnedIds = new Set(networkStops.map((s) => s.id));
  const starredIds = new Set(starredStops.map((s) => s.id));
  const starredNotPinned = starredStops.filter((s) => !networkPinnedIds.has(s.id));
  const nearbyOnly = nearbyStops.filter((s) => !starredIds.has(s.id) && !networkPinnedIds.has(s.id));

  const displayStops = [
    ...sortByDist(networkStops),
    ...sortByDist(starredNotPinned),
    ...nearbyOnly,
  ];

  if (page === "settings") {
    return (
      <Settings
        starred={starredStops}
        manualCoords={manualCoords}
        onStarredChange={handleStarredChange}
        onCoordsChange={handleCoordsChange}
        onBack={() => setPage("main")}
      />
    );
  }

  return (
    <main className="board">
      <header className="board-header">
        <h1>🚉 Abfahrten</h1>
        <div className="status-bar">{status}</div>
        <button className="refresh-btn" onClick={load} disabled={refreshing}>
          {refreshing ? "⟳" : "↺ Aktualisieren"}
        </button>
        <button className="settings-btn" onClick={() => setPage("settings")} title="Einstellungen">⚙</button>
      </header>

      {knownNetwork && (
        <div className="network-banner">
          <span className="wifi-icon"><ConnectionIcon type={connType} /></span>
          <span className="network-label">{knownNetwork.label}</span>
          <span className="network-ssid">{knownNetwork.ssid}</span>
        </div>
      )}

      {error && <p className="error">{error}</p>}

      {manualMode && (
        <p className="manual-notice">
          📍 GPS nicht verfügbar – Position aus Einstellungen. <button className="link-btn" onClick={() => setPage("settings")}>Ändern ⚙</button>
        </p>
      )}

      {displayStops.map((stop) => {
        const deps = departures[stop.id] ?? [];
        const isStarred = starredIds.has(stop.id);
        const isNetworkPinned = networkPinnedIds.has(stop.id);
        const isCollapsed = collapsedStops.has(stop.id);
        const dist = userLocation
          ? haversineKm(userLocation.lat, userLocation.lon, stop.latitude, stop.longitude)
          : null;

        return (
          <section key={stop.id} className={`stop-section${isStarred ? " pinned" : ""}${isNetworkPinned ? " net-pinned" : ""}`}>
            <h2 className="stop-name" onClick={() => toggleCollapse(stop.id)} role="button">
              <button
                className={`star-btn${isStarred ? " active" : ""}`}
                onClick={(e) => { e.stopPropagation(); toggleStar(stop); }}
                title={isStarred ? "Stern entfernen" : "Haltestelle merken"}
              >
                {isStarred ? "★" : "☆"}
              </button>
              {knownNetwork && (
                <button
                  className={`net-pin-btn${isNetworkPinned ? " active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); toggleNetworkPin(stop); }}
                  title={isNetworkPinned ? "Netzwerk-Pinning entfernen" : `An ${knownNetwork.ssid} pinnen`}
                >
                  📶
                </button>
              )}
              <span className="stop-name-text">{stop.name}</span>
              {dist !== null && <span className="dist-badge">{formatDist(dist)}</span>}
              <span className="collapse-icon">{isCollapsed ? "▶" : "▼"}</span>
            </h2>
            {!isCollapsed && (
              deps.length === 0 ? (
                <p className="no-deps">Keine Abfahrten</p>
              ) : (
                <table className="dep-table">
                  <tbody>
                    {deps.map((d, i) => (
                      <tr key={i} className={d.delay_minutes > 0 ? "dep-row late" : "dep-row"}>
                        <td>
                          <span className="line-badge" style={{ background: motColor(d.mot_type) }}>
                            {d.line}
                          </span>
                        </td>
                        <td className="direction">{d.direction}</td>
                        <td className="platform">{d.platform ? `Gl. ${d.platform}` : ""}</td>
                        <td className="time">
                          {d.delay_minutes !== 0 ? (
                            <><span className="planned-time">{d.planned_time}</span>
                              <span className="real-time">{d.real_time}</span></>
                          ) : (
                            <span>{d.planned_time}</span>
                          )}
                        </td>
                        <td><DelayBadge delay={d.delay_minutes} /></td>
                        <td className="countdown">
                          {d.countdown > MAX_COUNTDOWN_DISPLAY_MIN
                            ? <span className="time-far">{d.real_time}</span>
                            : <>{d.countdown} min</>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}
          </section>
        );
      })}
    </main>
  );
}

export default App;

