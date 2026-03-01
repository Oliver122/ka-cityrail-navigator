import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Stop, ManualCoords, saveStarred, saveManualCoords } from "./storage";
import { ConnectionInfo } from "./types";
import "./Settings.css";

interface Network {
  ssid: string;
  label: string;
}

interface Props {
  starred: Stop[];
  manualCoords: ManualCoords;
  onStarredChange: (stops: Stop[]) => void;
  onCoordsChange: (coords: ManualCoords) => void;
  onBack: () => void;
}

export default function Settings({ starred, manualCoords, onStarredChange, onCoordsChange, onBack }: Props) {
  const [lat, setLat] = useState(String(manualCoords.lat));
  const [lon, setLon] = useState(String(manualCoords.lon));
  const [coordsSaved, setCoordsSaved] = useState(false);

  // Networks state
  const [networks, setNetworks] = useState<Network[]>([]);
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
    invoke<Network[]>("get_networks").then(setNetworks).catch(() => {});
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
    <main className="settings">
      <header className="settings-header">
        <button className="back-btn" onClick={onBack}>← Zurück</button>
        <h1>Einstellungen</h1>
      </header>

      {/* ── Manual coordinates ── */}
      <section className="settings-section">
        <h2>📍 Manuelle Koordinaten</h2>
        <p className="settings-hint">
          Wird verwendet, wenn GPS nicht verfügbar oder verweigert ist.
        </p>
        <div className="coords-row">
          <label>
            Breitengrad (Lat)
            <input
              type="number"
              step="any"
              value={lat}
              onChange={(e) => { setLat(e.currentTarget.value); setCoordsSaved(false); }}
              placeholder="49.0090"
            />
          </label>
          <label>
            Längengrad (Lon)
            <input
              type="number"
              step="any"
              value={lon}
              onChange={(e) => { setLon(e.currentTarget.value); setCoordsSaved(false); }}
              placeholder="8.4040"
            />
          </label>
          <button className="save-btn" onClick={saveCoords}>
            {coordsSaved ? "✓ Gespeichert" : "Speichern"}
          </button>
        </div>
      </section>

      {/* ── Starred stops ── */}
      <section className="settings-section">
        <h2>★ Gemerkte Haltestellen</h2>

        {starred.length === 0 ? (
          <p className="settings-hint">Keine gemerkten Haltestellen.</p>
        ) : (
          <ul className="starred-list">
            {starred.map((s) => (
              <li key={s.id} className="starred-item">
                <span className="starred-name">{s.name}</span>
                <span className="starred-coords">{s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}</span>
                <button className="remove-btn" onClick={() => removeStarred(s.id)} title="Entfernen">✕</button>
              </li>
            ))}
          </ul>
        )}

        {/* Search to add */}
        <div className="search-box">
          <input
            type="text"
            className="search-input"
            placeholder="Haltestelle suchen…"
            value={query}
            onChange={(e) => handleQueryChange(e.currentTarget.value)}
          />
          {searching && <span className="search-spinner">⟳</span>}
        </div>
        {searchError && <p className="settings-error">{searchError}</p>}
        {searchResults.length > 0 && (
          <ul className="search-results">
            {searchResults.map((s) => (
              <li key={s.id} className="search-result-item">
                <span className="result-name">{s.name}</span>
                <button
                  className={`add-btn${starredIds.has(s.id) ? " added" : ""}`}
                  onClick={() => addStarred(s)}
                  disabled={starredIds.has(s.id)}
                >
                  {starredIds.has(s.id) ? "★ Gemerkt" : "☆ Merken"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {/* ── Known networks ── */}
      <section className="settings-section">
        <h2>
          <svg className="section-wifi-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M1.5 8.5a16.5 16.5 0 0 1 21 0M5 12.5a12 12 0 0 1 14 0M8.5 16.5a7.5 7.5 0 0 1 7 0M12 21h.01"/>
          </svg>
          Bekannte Netzwerke
        </h2>
        <p className="settings-hint">
          Wenn du mit einem dieser Netzwerke (WLAN oder Kabel) verbunden bist, wird oben ein Indikator angezeigt.
        </p>

        <div className="current-ssid-bar">
          {currentConn === "loading" ? (
            <span className="ssid-detecting">⟳ Verbindung wird erkannt…</span>
          ) : currentConn ? (
            <>
              <span className={`conn-type-badge conn-${currentConn.conn_type}`}>
                {currentConn.conn_type === "wifi" ? "📶 WLAN" : "🔌 Kabel"}
              </span>
              <span><strong>{currentConn.name}</strong></span>
              {networks.some((n) => n.ssid === currentConn.name)
                ? <span className="ssid-saved">✓ Bereits gespeichert</span>
                : <button className="save-btn" onClick={addCurrentNetwork} disabled={netSaving}>
                    {netSaving ? "…" : "⚡ Jetzt merken"}
                  </button>
              }
            </>
          ) : (
            <span className="ssid-none">Keine Verbindung erkannt</span>
          )}
          <button className="icon-btn" onClick={detectConn} title="Erneut erkennen">↺</button>
        </div>

        {networks.length > 0 && (
          <ul className="network-list">
            {networks.map((n) => (
              <li key={n.ssid} className={`network-item${n.ssid === currentName ? " active-net" : ""}`}>
                <div className="network-item-info">
                  <span className="network-item-label">{n.label}</span>
                  <span className="network-item-ssid">{n.ssid}</span>
                </div>
                <button className="remove-btn" onClick={() => removeNetwork(n.ssid)} title="Entfernen">✕</button>
              </li>
            ))}
          </ul>
        )}

        <div className="network-add-row">
          <input
            className="search-input"
            placeholder="SSID (Netzwerkname)"
            value={newSsid}
            onChange={(e) => setNewSsid(e.currentTarget.value)}
          />
          <input
            className="search-input"
            placeholder="Bezeichnung (optional)"
            value={newLabel}
            onChange={(e) => setNewLabel(e.currentTarget.value)}
          />
          <button className="save-btn" onClick={addNetwork} disabled={netSaving || !newSsid.trim()}>
            {netSaving ? "…" : "+ Hinzufügen"}
          </button>
        </div>
      </section>
    </main>
  );
}
