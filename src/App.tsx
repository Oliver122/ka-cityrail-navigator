import { useEffect, useState, useCallback, useRef, TouchEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentPosition, requestPermissions } from "@tauri-apps/plugin-geolocation";
import { Stop, ManualCoords, DisplaySettings, loadStarred, saveStarred, loadManualCoords, loadDisplaySettings } from "./storage";
import {
  ConnectionInfo,
  AppPage,
  DepartureDetail,
  Departure,
  NetworkInfo,
  TripStopSeqResponse,
} from "./types";
import { haversineKm, formatDist } from "./utils/geo";
import { kvDateTimeToDisplay } from "./utils/time";
import { withTimeout } from "./utils/async";
import { createMockRouteStops } from "./utils/mockRoute";
import {
  BottomNav,
  AppHeader,
  SearchBar,
  ErrorBanner,
  ManualModeBanner,
  LoadingScreen,
  StationCard,
  NetworkStatusCard,
  ProximityMapCard,
  getStationViewer,
} from "./components";
import type { MapBounds } from "./components";
import "./components/ProximityMap.css";
import Settings from "./Settings";
import DepartureDetails from "./DepartureDetails";
import "./App.css";

const PAGE_ORDER: AppPage[] = ["departures", "settings"];
const INVOKE_TIMEOUT_MS = 12_000;
/** Background / silent data refresh interval (1:30). */
const DATA_REFRESH_MS = 90_000;
const SWIPE_THRESHOLD = 80;

function scrollTopNearZero(target: EventTarget | null): boolean {
  if (target instanceof Element) {
    let node: Element | null = target;
    while (node) {
      const style = window.getComputedStyle(node);
      const canScroll =
        (style.overflowY === "auto" || style.overflowY === "scroll" || node === document.documentElement)
        && node.scrollHeight > node.clientHeight + 1;
      if (canScroll) return node.scrollTop <= 2;
      node = node.parentElement;
    }
  }
  return (window.scrollY || document.documentElement.scrollTop || 0) <= 2;
}

function App() {
  useEffect(() => {
    const handler = (e: PromiseRejectionEvent) => {
      e.preventDefault();
      console.warn("Unhandled rejection caught:", e.reason);
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, []);

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
  const [searchResults, setSearchResults] = useState<Stop[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedDeparture, setSelectedDeparture] = useState<DepartureDetail | null>(null);
  const [routeLoadingId, setRouteLoadingId] = useState<string | null>(null);
  const [routeLoadError, setRouteLoadError] = useState<string | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  const lastBoundsRef = useRef<string>("");
  const touchStartRef = useRef<{ x: number; y: number; target: EventTarget | null } | null>(null);
  const silentRefreshInFlight = useRef(false);
  const userLocationRef = useRef(userLocation);
  userLocationRef.current = userLocation;
  const initialLoadingRef = useRef(initialLoading);
  initialLoadingRef.current = initialLoading;
  const pageRef = useRef(page);
  pageRef.current = page;

  const handleTouchStart = useCallback((e: TouchEvent) => {
    touchStartRef.current = {
      x: e.touches[0].clientX,
      y: e.touches[0].clientY,
      target: e.target,
    };
  }, []);

  const loadFrom = useCallback(async (
    latitude: number,
    longitude: number,
    opts: { silent?: boolean } = {},
  ) => {
    const silent = opts.silent === true;
    if (!silent) {
      setUserLocation({ lat: latitude, lon: longitude });
      setError(null);
    } else {
      setUserLocation((prev) => prev ?? { lat: latitude, lon: longitude });
    }
    try {
      const settings = loadDisplaySettings();
      const nearby = await invoke<Stop[]>("fetch_stops_near", {
        latitude, longitude, radiusKm: 1.5, limit: settings.nearbyStopsLimit,
      });
      setNearbyStops(nearby);

      let netStops: Stop[] = [];
      try {
        const net = await withTimeout(
          invoke<NetworkInfo | null>("check_current_network"),
          8000,
          "Initial network check",
        );
        if (net) {
          netStops = await withTimeout(
            invoke<Stop[]>("get_network_stops", { ssid: net.ssid }),
            5000,
            "Initial network stops",
          );
          setNetworkStops(netStops);
          setKnownNetwork(net);
        }
      } catch { /* network detection is best-effort */ }

      const starred = loadStarred();
      const seenIds = new Set(nearby.map((s) => s.id));
      const extraStarred = starred.filter((s) => !seenIds.has(s.id));
      extraStarred.forEach((s) => seenIds.add(s.id));
      const extraNetwork = netStops.filter((s) => !seenIds.has(s.id));
      const all = [...nearby, ...extraStarred, ...extraNetwork];

      const results = await Promise.all(
        all.map((s) =>
          withTimeout(
            invoke<Departure[]>("fetch_departures", { stopId: s.id, timeWindowMinutes: settings.timeWindowMinutes }),
            INVOKE_TIMEOUT_MS,
            `Departures ${s.id}`,
          )
            .then((deps) => [s.id, deps] as [string, Departure[]])
            .catch(() => [s.id, []] as [string, Departure[]])
        )
      );
      setDepartures(Object.fromEntries(results));
      if (silent) setError(null);
    } catch (e) {
      if (!silent) setError(String(e));
      else console.warn("Silent data refresh failed:", e);
    }
  }, []);

  const refreshDataSilent = useCallback(async () => {
    if (silentRefreshInFlight.current || initialLoadingRef.current) return;
    silentRefreshInFlight.current = true;
    try {
      const loc = userLocationRef.current ?? loadManualCoords();
      await loadFrom(loc.lat, loc.lon, { silent: true });
    } finally {
      silentRefreshInFlight.current = false;
    }
  }, [loadFrom]);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    const startTarget = touchStartRef.current.target;
    touchStartRef.current = null;

    // Pull down at top of list → silent data refresh (no spinner / layout reset)
    if (
      pageRef.current === "departures"
      && deltaY >= SWIPE_THRESHOLD
      && Math.abs(deltaY) > Math.abs(deltaX)
      && scrollTopNearZero(startTarget)
    ) {
      void refreshDataSilent();
      return;
    }

    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaY) > Math.abs(deltaX)) return;
    if (pageRef.current === "details") return;

    const currentIndex = PAGE_ORDER.indexOf(pageRef.current);
    if (deltaX < 0 && currentIndex < PAGE_ORDER.length - 1) {
      setPage(PAGE_ORDER[currentIndex + 1]);
    } else if (deltaX > 0 && currentIndex > 0) {
      setPage(PAGE_ORDER[currentIndex - 1]);
    }
  }, [refreshDataSilent]);

  const handleMapBoundsChange = useCallback(async (bounds: MapBounds) => {
    const boundsKey = `${bounds.center.lat.toFixed(4)},${bounds.center.lon.toFixed(4)},${bounds.radiusKm.toFixed(2)}`;
    if (boundsKey === lastBoundsRef.current) return;
    lastBoundsRef.current = boundsKey;

    setMapLoading(true);
    try {
      const stops = await invoke<Stop[]>("fetch_stops_near", {
        latitude: bounds.center.lat,
        longitude: bounds.center.lon,
        radiusKm: Math.min(bounds.radiusKm * 1.5, 10),
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

  // Silent background refresh every 1:30 — data only (keeps collapse / search / scroll)
  useEffect(() => {
    if (initialLoading) return;
    const id = setInterval(() => {
      if (pageRef.current !== "departures") return;
      void refreshDataSilent();
    }, DATA_REFRESH_MS);
    return () => clearInterval(id);
  }, [initialLoading, refreshDataSilent]);

  useEffect(() => {
    const check = async () => {
      try {
        const [net, conn] = await Promise.all([
          withTimeout(invoke<NetworkInfo | null>("check_current_network"), 8000, "Network check"),
          withTimeout(invoke<ConnectionInfo | null>("get_current_connection"), 8000, "Connection check"),
        ]);
        setKnownNetwork(net);
        if (conn) setConnType(conn.conn_type);
        if (net) {
          const ns = await withTimeout(
            invoke<Stop[]>("get_network_stops", { ssid: net.ssid }),
            5000,
            "Network stops",
          );
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

  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearching(false);
      setSearchError(null);
      return;
    }

    setSearching(true);
    setSearchError(null);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const [dbResults, apiResults] = await Promise.allSettled([
          invoke<Stop[]>("search_stops_db", { query: q }),
          invoke<Stop[]>("search_stops", { query: q }),
        ]);
        const db = dbResults.status === "fulfilled" ? dbResults.value : [];
        const api = apiResults.status === "fulfilled" ? apiResults.value : [];
        const seen = new Set<string>();
        const merged: Stop[] = [];
        for (const s of [...db, ...api]) {
          if (!seen.has(s.id)) {
            seen.add(s.id);
            merged.push(s);
          }
        }
        setSearchResults(merged);
      } catch (e) {
        setSearchError(String(e));
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  // Fetch departures for global search hits (temp stations on departures page)
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2 || searchResults.length === 0) return;

    let cancelled = false;
    (async () => {
      const settings = loadDisplaySettings();
      const targets = searchResults.slice(0, 12);
      const results = await Promise.all(
        targets.map((s) =>
          withTimeout(
            invoke<Departure[]>("fetch_departures", {
              stopId: s.id,
              timeWindowMinutes: settings.timeWindowMinutes,
            }),
            INVOKE_TIMEOUT_MS,
            `Search departures ${s.id}`,
          )
            .then((deps) => [s.id, deps] as [string, Departure[]])
            .catch(() => [s.id, []] as [string, Departure[]])
        )
      );
      if (cancelled) return;
      setDepartures((prev) => ({ ...prev, ...Object.fromEntries(results) }));
    })();

    return () => {
      cancelled = true;
    };
  }, [searchQuery, searchResults]);

  const sortByDist = (arr: Stop[]) =>
    userLocation
      ? [...arr].sort((a, b) =>
          haversineKm(userLocation.lat, userLocation.lon, a.latitude, a.longitude) -
          haversineKm(userLocation.lat, userLocation.lon, b.latitude, b.longitude)
        )
      : arr;

  const networkPinnedIds = new Set(networkStops.map((s) => s.id));
  const starredIds = new Set(starredStops.map((s) => s.id));
  const starredNotPinned = starredStops.filter((s) => !networkPinnedIds.has(s.id));
  const nearbyOnly = nearbyStops.filter((s) => !starredIds.has(s.id) && !networkPinnedIds.has(s.id));

  const homeStops = [
    ...sortByDist(networkStops),
    ...sortByDist(starredNotPinned),
    ...nearbyOnly,
  ];
  const homeStopIds = new Set(homeStops.map((s) => s.id));

  const searchActive = searchQuery.trim().length >= 2;
  const displayStops = searchActive ? searchResults : homeStops;

  const handleDepartureClick = async (stop: Stop, dep: Departure) => {
    const detailId = `${stop.id}-${dep.line}-${dep.planned_time}`;
    setRouteLoadError(null);
    setRouteLoadingId(detailId);
    const detailBase: DepartureDetail = {
      id: detailId,
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
      tripCode: dep.trip_code,
      realtimeTripId: dep.realtime_trip_id,
      lineStateless: dep.line_stateless,
      routePath: "",
      routeStops: [],
      disruption: dep.delay_minutes > 5 ? `Delay of ${dep.delay_minutes} minutes due to operational issues` : undefined,
    };
    try {
      const route = await withTimeout(
        invoke<TripStopSeqResponse>("fetch_trip_stopseq", {
          stopId: dep.stop_id || stop.id,
          lineStateless: dep.line_stateless,
          tripCode: dep.trip_code,
          serviceDate: dep.service_date,
          serviceTime: dep.service_time,
        }),
        INVOKE_TIMEOUT_MS,
        "Route loading",
      );
      const currentStopId = dep.stop_id || stop.id;
      const hasRouteStops = route.route_stops.length > 0;
      const detail: DepartureDetail = {
        ...detailBase,
        tripCode: route.trip_code || dep.trip_code,
        lineStateless: route.line_stateless || dep.line_stateless,
        routePath: route.path,
        routeStops: hasRouteStops
          ? route.route_stops.map((s, i) => ({
              id: s.id || `${i}`,
              name: s.name,
              platform: s.platform,
              arrivalTime: kvDateTimeToDisplay(s.arrival_time),
              departureTime: kvDateTimeToDisplay(s.departure_time),
              longitude: s.longitude,
              latitude: s.latitude,
              status: s.id === currentStopId ? "current" : i === 0 ? "passed" : "upcoming",
              delayMinutes: dep.delay_minutes > 0 ? dep.delay_minutes : undefined,
            }))
          : createMockRouteStops(dep, stop.name),
        disruption: hasRouteStops ? detailBase.disruption : "Route data unavailable for this trip.",
      };
      setSelectedDeparture(detail);
      setPage("details");
    } catch (e) {
      setRouteLoadError(String(e));
      setSelectedDeparture({
        ...detailBase,
        routeStops: createMockRouteStops(dep, stop.name),
        disruption: "Could not load full route. Showing fallback data.",
      });
      setPage("details");
    } finally {
      setRouteLoadingId(null);
    }
  };

  const handleNavigate = (newPage: AppPage) => {
    if (newPage === "departures") {
      setSelectedDeparture(null);
    }
    setPage(newPage);
  };

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

  if (initialLoading) {
    return (
      <main className="app">
        <LoadingScreen />
        <BottomNav currentPage={page} onNavigate={handleNavigate} />
      </main>
    );
  }

  return (
    <div onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      <main className="app">
        <AppHeader
          connected={!!knownNetwork}
          connType={connType}
          connectionLabel={knownNetwork ? knownNetwork.label : "Offline"}
          refreshing={refreshing}
          onRefresh={load}
        >
          <SearchBar
            value={searchQuery}
            onChange={setSearchQuery}
            searching={searching}
          />
        </AppHeader>

        <div className="app-content">
          {error && <ErrorBanner message={error} />}
          {routeLoadError && <ErrorBanner message={routeLoadError} />}
          {searchError && <ErrorBanner message={searchError} />}
          {manualMode && !searchActive && (
            <ManualModeBanner onChangeLocation={() => setPage("settings")} />
          )}
          {searchActive && (
            <div className="search-results-banner">
              {searching
                ? "Searching all stations…"
                : `${searchResults.length} station${searchResults.length !== 1 ? "s" : ""} · clear search to return home`}
            </div>
          )}

          <div className="stations-list">
            {searchActive && !searching && searchResults.length === 0 && (
              <p className="no-departures search-empty">No stations found</p>
            )}
            {displayStops.map((stop) => {
              const deps = departures[stop.id] ?? [];
              const dist = userLocation
                ? haversineKm(userLocation.lat, userLocation.lon, stop.latitude, stop.longitude)
                : null;
              const Viewer = getStationViewer(displaySettings.stationViewerKind);
              const isTemp = searchActive && !homeStopIds.has(stop.id);

              return (
                <StationCard
                  key={stop.id}
                  stopId={stop.id}
                  name={stop.name}
                  distanceLabel={dist !== null ? formatDist(dist) : null}
                  starred={starredIds.has(stop.id)}
                  networkPinned={networkPinnedIds.has(stop.id)}
                  showNetworkPin={!!knownNetwork}
                  networkSsid={knownNetwork?.ssid}
                  collapsed={collapsedStops.has(stop.id)}
                  temporary={isTemp}
                  onToggleCollapse={() => toggleCollapse(stop.id)}
                  onToggleStar={() => toggleStar(stop)}
                  onToggleNetworkPin={() => toggleNetworkPin(stop)}
                >
                  <Viewer
                    stopId={stop.id}
                    departures={deps}
                    routeLoadingId={routeLoadingId}
                    onDepartureClick={(dep) => handleDepartureClick(stop, dep)}
                  />
                </StationCard>
              );
            })}
          </div>

          {!searchActive && knownNetwork && (
            <NetworkStatusCard
              label={knownNetwork.label}
              ssid={knownNetwork.ssid}
              pinnedCount={networkStops.length}
            />
          )}

          {!searchActive && (
          <ProximityMapCard
            userLocation={userLocation}
            stops={mapStops}
            loading={mapLoading}
            onBoundsChange={handleMapBoundsChange}
            onStopClick={(stop) => {
              const element = document.getElementById(`station-${stop.id}`);
              if (element) {
                element.scrollIntoView({ behavior: "smooth", block: "center" });
              }
            }}
          />
          )}
        </div>
      </main>
      <BottomNav currentPage={page} onNavigate={handleNavigate} />
    </div>
  );
}

export default App;
