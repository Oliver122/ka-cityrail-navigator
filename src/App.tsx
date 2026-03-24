import { useEffect, useState, useCallback, useRef, TouchEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentPosition, requestPermissions } from "@tauri-apps/plugin-geolocation";
import { Stop, ManualCoords, DisplaySettings, loadStarred, saveStarred, loadManualCoords, loadDisplaySettings } from "./storage";
import { ConnectionInfo, AppPage, DepartureDetail, RouteStop } from "./types";
import { 
  BottomNav, 
  LineBadge,
  ProximityMap,
  WifiIcon, 
  EthernetIcon, 
  SearchIcon, 
  FilterIcon, 
  RefreshIcon,
  LocationIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  StarIcon,
} from "./components";
import type { MapBounds } from "./components";
import "./components/ProximityMap.css";
import Settings from "./Settings";
import DepartureDetails from "./DepartureDetails";
import "./App.css";

// Page order for swipe navigation
const PAGE_ORDER: AppPage[] = ["departures", "settings"];

interface NetworkInfo {
  ssid: string;
  label: string;
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
  return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
}

function formatCountdown(countdown: number, realTime: string): { text: string; className: string } {
  if (countdown <= 0) return { text: "now", className: "eta-now" };
  if (countdown <= MAX_COUNTDOWN_DISPLAY_MIN) return { text: `${countdown} min`, className: "eta-soon" };
  return { text: realTime, className: "eta-later" };
}

// Create mock route stops for departure details
function createMockRouteStops(departure: Departure, stopName: string): RouteStop[] {
  return [
    { id: "1", name: "Hauptbahnhof", arrivalTime: departure.planned_time, status: "passed" },
    { id: "2", name: stopName, arrivalTime: departure.real_time, status: "current", delayMinutes: departure.delay_minutes },
    { id: "3", name: "Marktplatz", arrivalTime: "", status: "upcoming" },
    { id: "4", name: departure.direction, arrivalTime: "", status: "upcoming" },
  ];
}

// ── App ───────────────────────────────────────────────────────────────────────

function App() {
  const [page, setPage] = useState<AppPage>("departures");
  const [nearbyStops, setNearbyStops] = useState<Stop[]>([]);
  const [mapStops, setMapStops] = useState<Stop[]>([]);
  const [mapLoading, setMapLoading] = useState(false);
  const [starredStops, setStarredStops] = useState<Stop[]>(loadStarred);
  const [manualCoords, setManualCoords] = useState<ManualCoords>(loadManualCoords);
  const [displaySettings, setDisplaySettings] = useState<DisplaySettings>(loadDisplaySettings);
  const [departures, setDepartures] = useState<Record<string, Departure[]>>({});
  const [userLocation, setUserLocation] = useState<{ lat: number; lon: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDeparture, setSelectedDeparture] = useState<DepartureDetail | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  
  // Track last fetched bounds to avoid duplicate requests
  const lastBoundsRef = useRef<string>("");
  
  // Swipe gesture handling
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const SWIPE_THRESHOLD = 80;
  
  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }, []);
  
  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    
    // Only trigger if horizontal swipe is dominant
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaY) > Math.abs(deltaX)) return;
    
    // Skip swipe navigation on details page (use back button instead)
    if (page === "details") return;
    
    const currentIndex = PAGE_ORDER.indexOf(page);
    if (deltaX < 0 && currentIndex < PAGE_ORDER.length - 1) {
      // Swipe left -> next page
      setPage(PAGE_ORDER[currentIndex + 1]);
    } else if (deltaX > 0 && currentIndex > 0) {
      // Swipe right -> previous page
      setPage(PAGE_ORDER[currentIndex - 1]);
    }
  }, [page]);

  // Fetch stops within map bounds
  const handleMapBoundsChange = useCallback(async (bounds: MapBounds) => {
    // Create a key to detect if bounds significantly changed
    const boundsKey = `${bounds.center.lat.toFixed(4)},${bounds.center.lon.toFixed(4)},${bounds.radiusKm.toFixed(2)}`;
    if (boundsKey === lastBoundsRef.current) return;
    lastBoundsRef.current = boundsKey;
    
    setMapLoading(true);
    try {
      // Fetch stops for the visible map area (increased limit for map view)
      const stops = await invoke<Stop[]>("fetch_stops_near", {
        latitude: bounds.center.lat,
        longitude: bounds.center.lon,
        radiusKm: Math.min(bounds.radiusKm * 1.5, 10), // Cap at 10km
        limit: 50,
      });
      setMapStops(stops);
    } catch (e) {
      console.error("Failed to fetch map stops:", e);
    } finally {
      setMapLoading(false);
    }
  }, []);

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

  const handleDisplaySettingsChange = useCallback((settings: DisplaySettings) => {
    setDisplaySettings(settings);
  }, []);

  const loadFrom = useCallback(async (latitude: number, longitude: number) => {
    setUserLocation({ lat: latitude, lon: longitude });
    setError(null);
    try {
      const settings = loadDisplaySettings();
      const nearby = await invoke<Stop[]>("fetch_stops_near", {
        latitude, longitude, radiusKm: 1.5, limit: settings.nearbyStopsLimit,
      });
      setNearbyStops(nearby);

      // Also load departures for starred stops not already in the nearby list
      const starred = loadStarred();
      const extraStarred = starred.filter((s) => !nearby.some((n) => n.id === s.id));
      const all = [...nearby, ...extraStarred];

      const results = await Promise.all(
        all.map((s) =>
          invoke<Departure[]>("fetch_departures", { stopId: s.id, timeWindowMinutes: settings.timeWindowMinutes })
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
          await loadFrom(saved.lat, saved.lon);
          setRefreshing(false);
          setInitialLoading(false);
          return;
        }
        const pos = await getCurrentPosition({ enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 });
        setManualMode(false);
        await loadFrom(pos.coords.latitude, pos.coords.longitude);
      } catch {
        // GPS failed — silently fall back to saved manual coords
        const saved = loadManualCoords();
        setManualMode(true);
        await loadFrom(saved.lat, saved.lon);
      } finally {
        setRefreshing(false);
        setInitialLoading(false);
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

  // Filter by search query
  const filterBySearch = (stops: Stop[]) => {
    if (!searchQuery.trim()) return stops;
    const q = searchQuery.toLowerCase();
    return stops.filter((s) => s.name.toLowerCase().includes(q));
  };

  const displayStops = filterBySearch([
    ...sortByDist(networkStops),
    ...sortByDist(starredNotPinned),
    ...nearbyOnly,
  ]);

  // Handle departure click to show details
  const handleDepartureClick = (stop: Stop, dep: Departure) => {
    const detail: DepartureDetail = {
      id: `${stop.id}-${dep.line}-${dep.planned_time}`,
      line: dep.line,
      lineType: dep.line_type,
      motType: dep.mot_type,
      direction: dep.direction,
      platform: dep.platform,
      plannedTime: dep.planned_time,
      realTime: dep.real_time,
      delayMinutes: dep.delay_minutes,
      countdown: dep.countdown,
      stopName: stop.name,
      routeStops: createMockRouteStops(dep, stop.name),
      disruption: dep.delay_minutes > 5 ? `Delay of ${dep.delay_minutes} minutes due to operational issues` : undefined,
    };
    setSelectedDeparture(detail);
    setPage("details");
  };

  // Handle navigation
  const handleNavigate = (newPage: AppPage) => {
    if (newPage === "departures") {
      setSelectedDeparture(null);
    }
    setPage(newPage);
  };

  // Settings page
  if (page === "settings") {
    return (
      <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        <Settings
          starred={starredStops}
          manualCoords={manualCoords}
          displaySettings={displaySettings}
          onStarredChange={handleStarredChange}
          onCoordsChange={handleCoordsChange}
          onDisplaySettingsChange={handleDisplaySettingsChange}
        />
        <BottomNav currentPage={page} onNavigate={handleNavigate} />
      </div>
    );
  }

  // Departure Details page
  if (page === "details" && selectedDeparture) {
    return (
      <>
        <DepartureDetails 
          departure={selectedDeparture} 
          onBack={() => { setSelectedDeparture(null); setPage("departures"); }}
        />
        <BottomNav currentPage={page} onNavigate={handleNavigate} />
      </>
    );
  }

  // Initial loading screen
  if (initialLoading) {
    return (
      <main className="app">
        <div className="loading-screen">
          <div className="loading-logo">
            <span className="logo-text">K2V</span>
            <span className="logo-subtitle">CityRail</span>
          </div>
          <div className="loading-spinner">
            <RefreshIcon />
          </div>
          <p className="loading-text">Loading nearby stations...</p>
        </div>
        <BottomNav currentPage={page} onNavigate={handleNavigate} />
      </main>
    );
  }

  // Main departures page
  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <main className="app">
        {/* Header */}
        <header className="app-header">
          <div className="header-top">
            <div className="logo">
              <span className="logo-text">K2V</span>
              <span className="logo-subtitle">CityRail</span>
            </div>
            <div className="header-status">
              {knownNetwork ? (
                <div className="connection-indicator connected">
                  {connType === "wifi" ? <WifiIcon /> : <EthernetIcon />}
                  <span>{knownNetwork.label}</span>
                </div>
              ) : (
                <div className="connection-indicator">
                  <WifiIcon />
                  <span>Offline</span>
                </div>
              )}
              <button 
                className={`refresh-button${refreshing ? " refreshing" : ""}`} 
                onClick={load}
                disabled={refreshing}
              >
                <RefreshIcon />
              </button>
            </div>
          </div>
          
          {/* Search Bar */}
          <div className="search-bar">
            <SearchIcon className="search-icon" />
            <input
              type="text"
              placeholder="Search stations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button className="filter-button">
              <FilterIcon />
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="app-content">
          {error && (
            <div className="error-banner">
              <span>{error}</span>
            </div>
          )}

          {manualMode && (
            <div className="manual-mode-banner">
              <LocationIcon />
              <span>Using manual location</span>
              <button onClick={() => setPage("settings")}>Change</button>
            </div>
          )}

          {/* Station Cards */}
          <div className="stations-list">
            {displayStops.map((stop) => {
              const deps = departures[stop.id] ?? [];
              const isStarred = starredIds.has(stop.id);
              const isNetworkPinned = networkPinnedIds.has(stop.id);
              const isCollapsed = collapsedStops.has(stop.id);
              const dist = userLocation
                ? haversineKm(userLocation.lat, userLocation.lon, stop.latitude, stop.longitude)
                : null;

              return (
                <section key={stop.id} id={`station-${stop.id}`} className={`station-card${isStarred ? " starred" : ""}${isNetworkPinned ? " network-pinned" : ""}`}>
                  <div className="station-header" onClick={() => toggleCollapse(stop.id)}>
                    <button
                      className={`star-button${isStarred ? " active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); toggleStar(stop); }}
                    >
                      <StarIcon filled={isStarred} />
                    </button>
                    {knownNetwork && (
                      <button
                        className={`network-pin-button${isNetworkPinned ? " active" : ""}`}
                        onClick={(e) => { e.stopPropagation(); toggleNetworkPin(stop); }}
                        title={isNetworkPinned ? "Remove network pin" : `Pin to ${knownNetwork.ssid}`}
                      >
                        <WifiIcon />
                      </button>
                    )}
                    <div className="station-info">
                      <span className="station-name">{stop.name}</span>
                      {dist !== null && <span className="station-distance">{formatDist(dist)}</span>}
                    </div>
                    <button className="collapse-button">
                      {isCollapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                    </button>
                  </div>
                  
                  {!isCollapsed && (
                    <div className="departures-table">
                      {deps.length === 0 ? (
                        <p className="no-departures">No departures</p>
                      ) : (
                        <>
                          {/* Table Header */}
                          <div className="departures-header">
                            <span className="col-line">Line</span>
                            <span className="col-destination">Destination</span>
                            <span className="col-platform">Pl.</span>
                            <span className="col-scheduled">Sched.</span>
                            <span className="col-eta">ETA</span>
                          </div>
                          {/* Table Rows - Scrollable */}
                          <div className="departures-rows-wrapper">
                            {deps.map((dep, i) => {
                              const eta = formatCountdown(dep.countdown, dep.real_time);
                              const isDelayed = dep.delay_minutes > 0;
                              
                              return (
                                <div 
                                  key={i} 
                                  className="departure-row"
                                  onClick={() => handleDepartureClick(stop, dep)}
                                >
                                  <span className="col-line">
                                    <LineBadge line={dep.line} motType={dep.mot_type} />
                                  </span>
                                  <span className="col-destination">{dep.direction}</span>
                                  <span className="col-platform">{dep.platform || "-"}</span>
                                  <span className="col-scheduled">{dep.planned_time}</span>
                                  <span className={`col-eta ${isDelayed ? "delayed" : ""}`}>
                                    {isDelayed ? `+${dep.delay_minutes} min` : eta.text}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>

          {/* Network Status Card */}
          {knownNetwork && (
            <div className="network-status-card">
              <div className="network-status-header">
                <span className="network-status-title">Network Status</span>
                <span className="network-status-live">● Live</span>
              </div>
              <div className="network-status-info">
                <span className="network-name">{knownNetwork.label}</span>
                <span className="network-ssid">{knownNetwork.ssid}</span>
              </div>
              {networkStops.length > 0 && (
                <div className="network-pinned-count">
                  {networkStops.length} pinned station{networkStops.length !== 1 ? "s" : ""}
                </div>
              )}
            </div>
          )}

          {/* Proximity Map with OpenStreetMap */}
          <div className="map-card">
            <div className="map-header">
              <span className="map-title">Proximity Map</span>
              <span className="map-stop-count">
                {mapLoading ? "Loading..." : `${mapStops.length} stops in view`}
              </span>
            </div>
            <ProximityMap
              userLocation={userLocation}
              stops={mapStops}
              loading={mapLoading}
              onBoundsChange={handleMapBoundsChange}
              onStopClick={(stop) => {
                // Check if stop is in display list, if so scroll to it
                const element = document.getElementById(`station-${stop.id}`);
                if (element) {
                  element.scrollIntoView({ behavior: "smooth", block: "center" });
                }
              }}
            />
          </div>
        </div>
      </main>
      <BottomNav currentPage={page} onNavigate={handleNavigate} />
    </div>
  );
}

export default App;

