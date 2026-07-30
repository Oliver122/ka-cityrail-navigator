import type { ConnectionInfo } from "../../types";
import {
  CloseIcon,
  EthernetIcon,
  PlusIcon,
  RefreshIcon,
  WifiIcon,
} from "../Icons";

export type KnownNetwork = {
  ssid: string;
  label: string;
};

type Props = {
  networks: KnownNetwork[];
  currentConn: ConnectionInfo | null | "loading";
  newSsid: string;
  newLabel: string;
  netSaving: boolean;
  onDetect: () => void;
  onAddCurrent: () => void;
  onRemove: (ssid: string) => void;
  onAdd: () => void;
  onNewSsidChange: (value: string) => void;
  onNewLabelChange: (value: string) => void;
};

export default function KnownNetworksSection({
  networks,
  currentConn,
  newSsid,
  newLabel,
  netSaving,
  onDetect,
  onAddCurrent,
  onRemove,
  onAdd,
  onNewSsidChange,
  onNewLabelChange,
}: Props) {
  const currentName =
    currentConn && currentConn !== "loading" ? currentConn.name : null;

  return (
    <section className="config-section">
      <div className="section-header">
        <WifiIcon className="section-icon" />
        <h2>Known Networks</h2>
      </div>
      <p className="section-hint">
        When connected to one of these networks, a status indicator will appear.
      </p>

      <div className="current-connection">
        {currentConn === "loading" ? (
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
              <button className="register-button" onClick={onAddCurrent} disabled={netSaving}>
                {netSaving ? "..." : "Register"}
              </button>
            )}
            <button className="refresh-connection" onClick={onDetect}>
              <RefreshIcon />
            </button>
          </div>
        ) : (
          <div className="connection-status offline">
            <WifiIcon />
            <span>No connection detected</span>
            <button className="refresh-connection" onClick={onDetect}>
              <RefreshIcon />
            </button>
          </div>
        )}
      </div>

      {networks.length > 0 && (
        <ul className="networks-list">
          {networks.map((n) => (
            <li key={n.ssid} className={`network-item${n.ssid === currentName ? " active" : ""}`}>
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
              <button className="remove-button" onClick={() => onRemove(n.ssid)} title="Remove">
                <CloseIcon />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="add-network-form">
        <h3>Register New Node</h3>
        <div className="network-inputs">
          <input
            type="text"
            placeholder="Network SSID"
            value={newSsid}
            onChange={(e) => onNewSsidChange(e.currentTarget.value)}
          />
          <input
            type="text"
            placeholder="Label (optional)"
            value={newLabel}
            onChange={(e) => onNewLabelChange(e.currentTarget.value)}
          />
        </div>
        <button
          className="primary-button"
          onClick={onAdd}
          disabled={netSaving || !newSsid.trim()}
        >
          <PlusIcon />
          <span>Add Network</span>
        </button>
      </div>
    </section>
  );
}
