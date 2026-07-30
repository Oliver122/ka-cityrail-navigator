import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stop, ManualCoords, DisplaySettings, saveStarred, saveManualCoords, saveDisplaySettings } from "./storage";
import { ConnectionInfo } from "./types";
import type { StationViewerKind } from "./stationViewerKind";
import {
  ManualCoordsSection,
  DisplaySettingsSection,
  SavedTerminalsSection,
  KnownNetworksSection,
  FactoryResetSection,
  type KnownNetwork,
} from "./components";
import "./Settings.css";

interface Props {
  starred: Stop[];
  manualCoords: ManualCoords;
  displaySettings: DisplaySettings;
  onStarredChange: (stops: Stop[]) => void;
  onCoordsChange: (coords: ManualCoords) => void;
  onDisplaySettingsChange: (settings: DisplaySettings) => void;
}

export default function Settings({
  starred,
  manualCoords,
  displaySettings,
  onStarredChange,
  onCoordsChange,
  onDisplaySettingsChange,
}: Props) {
  const [lat, setLat] = useState(String(manualCoords.lat));
  const [lon, setLon] = useState(String(manualCoords.lon));
  const [coordsSaved, setCoordsSaved] = useState(false);

  const [nearbyLimit, setNearbyLimit] = useState(String(displaySettings.nearbyStopsLimit));
  const [timeWindow, setTimeWindow] = useState(String(displaySettings.timeWindowMinutes));
  const [stationViewerKind, setStationViewerKind] = useState<StationViewerKind>(
    displaySettings.stationViewerKind,
  );
  const [displaySaved, setDisplaySaved] = useState(false);

  const [networks, setNetworks] = useState<KnownNetwork[]>([]);
  const [currentConn, setCurrentConn] = useState<ConnectionInfo | null | "loading">("loading");
  const [newSsid, setNewSsid] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [netSaving, setNetSaving] = useState(false);

  const detectConn = useCallback(() => {
    setCurrentConn("loading");
    invoke<ConnectionInfo | null>("get_current_connection")
      .then((v) => setCurrentConn(v))
      .catch(() => setCurrentConn(null));
  }, []);

  useEffect(() => {
    invoke<KnownNetwork[]>("get_networks").then(setNetworks).catch(() => {});
    detectConn();
  }, [detectConn]);

  const addNetwork = async () => {
    const ssid = newSsid.trim();
    const label = newLabel.trim() || ssid;
    if (!ssid) return;
    setNetSaving(true);
    try {
      await invoke("add_network", { ssid, label });
      const updated = await invoke<KnownNetwork[]>("get_networks");
      setNetworks(updated);
      setNewSsid("");
      setNewLabel("");
    } finally {
      setNetSaving(false);
    }
  };

  const currentName = currentConn && currentConn !== "loading" ? currentConn.name : null;

  const addCurrentNetwork = async () => {
    if (!currentName) return;
    setNetSaving(true);
    try {
      await invoke("add_network", { ssid: currentName, label: currentName });
      const updated = await invoke<KnownNetwork[]>("get_networks");
      setNetworks(updated);
    } finally {
      setNetSaving(false);
    }
  };

  const removeNetwork = async (ssid: string) => {
    await invoke("remove_network", { ssid });
    setNetworks((prev) => prev.filter((n) => n.ssid !== ssid));
  };

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Stop[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const saveCoords = () => {
    const coords: ManualCoords = { lat: parseFloat(lat), lon: parseFloat(lon) };
    saveManualCoords(coords);
    onCoordsChange(coords);
    setCoordsSaved(true);
    setTimeout(() => setCoordsSaved(false), 2000);
  };

  const clamp = (value: string, min: number, max: number, fallback: number) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
  };

  const saveDisplay = () => {
    const settings: DisplaySettings = {
      nearbyStopsLimit: clamp(nearbyLimit, 1, 20, displaySettings.nearbyStopsLimit),
      timeWindowMinutes: clamp(timeWindow, 15, 180, displaySettings.timeWindowMinutes),
      stationViewerKind,
    };
    setNearbyLimit(String(settings.nearbyStopsLimit));
    setTimeWindow(String(settings.timeWindowMinutes));
    setStationViewerKind(settings.stationViewerKind);
    saveDisplaySettings(settings);
    onDisplaySettingsChange(settings);
    setDisplaySaved(true);
    setTimeout(() => setDisplaySaved(false), 2000);
  };

  const removeStarred = (id: string) => {
    const next = starred.filter((s) => s.id !== id);
    saveStarred(next);
    onStarredChange(next);
  };

  const addStarred = (stop: Stop) => {
    if (starred.some((s) => s.id === stop.id)) return;
    const next = [...starred, stop];
    saveStarred(next);
    onStarredChange(next);
  };

  const handleQueryChange = useCallback((val: string) => {
    setQuery(val);
    setSearchError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const [dbResults, apiResults] = await Promise.allSettled([
          invoke<Stop[]>("search_stops_db", { query: val.trim() }),
          invoke<Stop[]>("search_stops", { query: val.trim() }),
        ]);
        const db = dbResults.status === "fulfilled" ? dbResults.value : [];
        const api = apiResults.status === "fulfilled" ? apiResults.value : [];
        const seen = new Set<string>();
        const merged: Stop[] = [];
        for (const s of [...db, ...api]) {
          if (!seen.has(s.id)) { seen.add(s.id); merged.push(s); }
        }
        setSearchResults(merged);
      } catch (e) {
        setSearchError(String(e));
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  return (
    <main className="config-page">
      <header className="config-header">
        <div className="config-header-top">
          <h1>System Configuration</h1>
        </div>
      </header>

      <div className="config-content">
        <ManualCoordsSection
          lat={lat}
          lon={lon}
          saved={coordsSaved}
          onLatChange={(v) => { setLat(v); setCoordsSaved(false); }}
          onLonChange={(v) => { setLon(v); setCoordsSaved(false); }}
          onSave={saveCoords}
        />

        <DisplaySettingsSection
          nearbyLimit={nearbyLimit}
          timeWindow={timeWindow}
          stationViewerKind={stationViewerKind}
          saved={displaySaved}
          onNearbyLimitChange={(v) => { setNearbyLimit(v); setDisplaySaved(false); }}
          onTimeWindowChange={(v) => { setTimeWindow(v); setDisplaySaved(false); }}
          onStationViewerKindChange={(v) => { setStationViewerKind(v); setDisplaySaved(false); }}
          onNearbyLimitBlur={() =>
            setNearbyLimit(String(clamp(nearbyLimit, 1, 20, displaySettings.nearbyStopsLimit)))
          }
          onTimeWindowBlur={() =>
            setTimeWindow(String(clamp(timeWindow, 15, 180, displaySettings.timeWindowMinutes)))
          }
          onSave={saveDisplay}
        />

        <SavedTerminalsSection
          starred={starred}
          query={query}
          searchResults={searchResults}
          searching={searching}
          searchError={searchError}
          onQueryChange={handleQueryChange}
          onAdd={addStarred}
          onRemove={removeStarred}
        />

        <KnownNetworksSection
          networks={networks}
          currentConn={currentConn}
          newSsid={newSsid}
          newLabel={newLabel}
          netSaving={netSaving}
          onDetect={detectConn}
          onAddCurrent={addCurrentNetwork}
          onRemove={removeNetwork}
          onAdd={addNetwork}
          onNewSsidChange={setNewSsid}
          onNewLabelChange={setNewLabel}
        />

        <FactoryResetSection />
      </div>
    </main>
  );
}
