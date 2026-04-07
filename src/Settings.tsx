import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stop, ManualCoords, DisplaySettings, saveStarred, saveManualCoords, saveDisplaySettings, loadManualNetworkSsid, saveManualNetworkSsid } from "./storage";
import { ConnectionInfo } from "./types";
import { 
  WifiIcon, 
  EthernetIcon, 
  SearchIcon, 
  RefreshIcon, 
  CloseIcon, 
  PlusIcon,
  LocationIcon,
  StarIcon,
  SettingsIcon,
} from "./components/Icons";
import "./Settings.css";

interface Network {
  ssid: string;
  label: string;
}

interface Props {
  starred: Stop[];
  manualCoords: ManualCoords;
  displaySettings: DisplaySettings;
  onStarredChange: (stops: Stop[]) => void;
  onCoordsChange: (coords: ManualCoords) => void;
  onDisplaySettingsChange: (settings: DisplaySettings) => void;
}

export default function Settings({ starred, manualCoords, displaySettings, onStarredChange, onCoordsChange, onDisplaySettingsChange }: Props) {
  const [lat, setLat] = useState(String(manualCoords.lat));
  const [lon, setLon] = useState(String(manualCoords.lon));
  const [coordsSaved, setCoordsSaved] = useState(false);

  // Display settings state
  const [nearbyLimit, setNearbyLimit] = useState(displaySettings.nearbyStopsLimit);
  const [timeWindow, setTimeWindow] = useState(displaySettings.timeWindowMinutes);
  const [displaySaved, setDisplaySaved] = useState(false);

  // Networks state
  const [networks, setNetworks] = useState<Network[]>([]);
  const [currentConn, setCurrentConn] = useState<ConnectionInfo | null | "loading">("loading");
  const [networkDetectionAvailable, setNetworkDetectionAvailable] = useState<boolean | null>(null);
  const [manualNetworkSsid, setManualNetworkSsid] = useState<string | null>(loadManualNetworkSsid);
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
    invoke<Network[]>("get_networks").then(setNetworks).catch(() => {});
    invoke<boolean>("is_network_detection_available")
      .then(setNetworkDetectionAvailable)
      .catch(() => setNetworkDetectionAvailable(false));
    detectConn();
  }, [detectConn]);

  const addNetwork = async () => {
    const ssid = newSsid.trim();
    const label = newLabel.trim() || ssid;
    if (!ssid) return;
    setNetSaving(true);
    try {
      await invoke("add_network", { ssid, label });
      const updated = await invoke<Network[]>("get_networks");
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
      const updated = await invoke<Network[]>("get_networks");
      setNetworks(updated);
    } finally {
      setNetSaving(false);
    }
  };

  const removeNetwork = async (ssid: string) => {
    await invoke("remove_network", { ssid });
    setNetworks((prev) => prev.filter((n) => n.ssid !== ssid));
    if (manualNetworkSsid === ssid) {
      saveManualNetworkSsid(null);
      setManualNetworkSsid(null);
    }
  };

  const selectManualNetwork = (ssid: string) => {
    const next = manualNetworkSsid === ssid ? null : ssid;
    saveManualNetworkSsid(next);
    setManualNetworkSsid(next);
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

  const saveDisplay = () => {
    const settings: DisplaySettings = { nearbyStopsLimit: nearbyLimit, timeWindowMinutes: timeWindow };
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
        // Search DB (fast, local) and API (KVV stopfinder) in parallel
        const [dbResults, apiResults] = await Promise.allSettled([
          invoke<Stop[]>("search_stops_db", { query: val.trim() }),
          invoke<Stop[]>("search_stops", { query: val.trim() }),
        ]);
        const db  = dbResults.status  === "fulfilled" ? dbResults.value  : [];
        const api = apiResults.status === "fulfilled" ? apiResults.value : [];
        // Merge, deduplicate by id, DB results first
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

  const starredIds = new Set(starred.map((s) => s.id));

  return (
    <main className="config-page">
      {/* Header */}
      <header className="config-header">
        <div className="config-header-top">
          <h1>System Configuration</h1>
        </div>
      </header>

      <div className="config-content">
        {/* Manual Coordinates Section */}
        <section className="config-section">
          <div className="section-header">
            <LocationIcon className="section-icon" />
            <h2>Manual Coordinates</h2>
          </div>
          <p className="section-hint">
            Used when GPS is unavailable or denied.
          </p>
          
          <div className="coords-form">
            <div className="coord-input-group">
              <label>Latitude</label>
              <input
                type="number"
                step="any"
                value={lat}
                onChange={(e) => { setLat(e.currentTarget.value); setCoordsSaved(false); }}
                placeholder="49.0090"
              />
            </div>
            <div className="coord-input-group">
              <label>Longitude</label>
              <input
                type="number"
                step="any"
                value={lon}
                onChange={(e) => { setLon(e.currentTarget.value); setCoordsSaved(false); }}
                placeholder="8.4040"
              />
            </div>
          </div>
          <button className={`primary-button${coordsSaved ? " success" : ""}`} onClick={saveCoords}>
            {coordsSaved ? "✓ Saved" : "Update Location"}
          </button>
        </section>

        {/* Display Settings Section */}
        <section className="config-section">
          <div className="section-header">
            <SettingsIcon className="section-icon" />
            <h2>Display Settings</h2>
          </div>
          <p className="section-hint">
            Control how many stops and departures are shown.
          </p>
          
          <div className="coords-form">
            <div className="coord-input-group">
              <label>Nearby Stops</label>
              <input
                type="number"
                min="1"
                max="20"
                value={nearbyLimit}
                onChange={(e) => { setNearbyLimit(Math.max(1, Math.min(20, parseInt(e.currentTarget.value) || 1))); setDisplaySaved(false); }}
              />
            </div>
            <div className="coord-input-group">
              <label>Time Window (min)</label>
              <input
                type="number"
                min="15"
                max="180"
                value={timeWindow}
                onChange={(e) => { setTimeWindow(Math.max(15, Math.min(180, parseInt(e.currentTarget.value) || 60))); setDisplaySaved(false); }}
              />
            </div>
          </div>
          <button className={`primary-button${displaySaved ? " success" : ""}`} onClick={saveDisplay}>
            {displaySaved ? "✓ Saved" : "Update Settings"}
          </button>
        </section>

        {/* Saved Terminals Section */}
        <section className="config-section">
          <div className="section-header">
            <StarIcon filled className="section-icon starred-icon" />
            <h2>Saved Terminals</h2>
            {starred.length > 0 && (
              <span className="section-count">{starred.length} active</span>
            )}
          </div>

          {/* Search to add */}
          <div className="terminal-search">
            <SearchIcon className="search-icon" />
            <input
              type="text"
              placeholder="Search stations..."
              value={query}
              onChange={(e) => handleQueryChange(e.currentTarget.value)}
            />
            {searching && <RefreshIcon className="search-spinner" />}
          </div>
          
          {searchError && <p className="config-error">{searchError}</p>}
          
          {searchResults.length > 0 && (
            <ul className="search-results-list">
              {searchResults.map((s) => (
                <li key={s.id} className="search-result-item">
                  <span className="result-name">{s.name}</span>
                  <button
                    className={`add-button${starredIds.has(s.id) ? " added" : ""}`}
                    onClick={() => addStarred(s)}
                    disabled={starredIds.has(s.id)}
                  >
                    {starredIds.has(s.id) ? (
                      <>
                        <StarIcon filled />
                        <span>Saved</span>
                      </>
                    ) : (
                      <>
                        <PlusIcon />
                        <span>Add</span>
                      </>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {starred.length === 0 ? (
            <p className="empty-state">No saved terminals yet. Search above to add some.</p>
          ) : (
            <ul className="terminals-list">
              {starred.map((s) => (
                <li key={s.id} className="terminal-item">
                  <div className="terminal-info">
                    <span className="terminal-name">{s.name}</span>
                    <span className="terminal-coords">{s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}</span>
                  </div>
                  <button className="remove-button" onClick={() => removeStarred(s.id)} title="Remove">
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Known Networks Section */}
        <section className="config-section">
          <div className="section-header">
            <WifiIcon className="section-icon" />
            <h2>Known Networks</h2>
          </div>
          <p className="section-hint">
            When connected to one of these networks, a status indicator will appear.
          </p>

          {/* Current Connection */}
          <div className="current-connection">
            {networkDetectionAvailable === false ? (
              <div className="connection-status offline">
                <WifiIcon />
                <span>Automatic network detection is unavailable on this device. Select a registered network below.</span>
              </div>
            ) : (
              currentConn === "loading" ? (
              <div className="connection-status detecting">
                <RefreshIcon className="spin" />
                <span>Detecting connection...</span>
              </div>
            ) : currentConn ? (
              <div className="connection-status connected">
                <div className="connection-badge">
                  {currentConn.conn_type === "wifi" ? <WifiIcon /> : <EthernetIcon />}
                  <span>{currentConn.conn_type === "wifi" ? "WiFi" : "Ethernet"}</span>
                </div>
                <span className="connection-name">{currentConn.name}</span>
                {networks.some((n) => n.ssid === currentConn.name) ? (
                  <span className="connection-saved">✓ Registered</span>
                ) : (
                  <button className="register-button" onClick={addCurrentNetwork} disabled={netSaving}>
                    {netSaving ? "..." : "Register"}
                  </button>
                )}
                <button className="refresh-connection" onClick={detectConn}>
                  <RefreshIcon />
                </button>
              </div>
            ) : (
              <div className="connection-status offline">
                <WifiIcon />
                <span>No connection detected</span>
                <button className="refresh-connection" onClick={detectConn}>
                  <RefreshIcon />
                </button>
              </div>
            )
            )}
          </div>

          {/* Registered Networks List */}
          {networks.length > 0 && (
            <ul className="networks-list">
              {networks.map((n) => (
                <li key={n.ssid} className={`network-item${n.ssid === currentName || (networkDetectionAvailable === false && n.ssid === manualNetworkSsid) ? " active" : ""}`}>
                  <div className="network-info">
                    <WifiIcon className="network-icon" />
                    <div className="network-details">
                      <span className="network-label">{n.label}</span>
                      <span className="network-ssid">{n.ssid}</span>
                    </div>
                  </div>
                  {n.ssid === currentName && (
                    <span className="network-active-badge">Connected</span>
                  )}
                  {networkDetectionAvailable === false && n.ssid === manualNetworkSsid && (
                    <span className="network-active-badge">Manual active</span>
                  )}
                  {networkDetectionAvailable === false && (
                    <button className="register-button" onClick={() => selectManualNetwork(n.ssid)}>
                      {manualNetworkSsid === n.ssid ? "Clear active" : "Set active"}
                    </button>
                  )}
                  <button className="remove-button" onClick={() => removeNetwork(n.ssid)} title="Remove">
                    <CloseIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add Network Form */}
          <div className="add-network-form">
            <h3>Register New Node</h3>
            <div className="network-inputs">
              <input
                type="text"
                placeholder="Network SSID"
                value={newSsid}
                onChange={(e) => setNewSsid(e.currentTarget.value)}
              />
              <input
                type="text"
                placeholder="Label (optional)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.currentTarget.value)}
              />
            </div>
            <button 
              className="primary-button" 
              onClick={addNetwork} 
              disabled={netSaving || !newSsid.trim()}
            >
              <PlusIcon />
              <span>Add Network</span>
            </button>
          </div>
        </section>

        {/* Factory Reset */}
        <section className="config-section danger-section">
          <button className="danger-button">
            Factory Reset
          </button>
          <p className="danger-hint">This will clear all saved data and settings.</p>
        </section>
      </div>
    </main>
  );
}
