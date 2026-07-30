import type { ReactNode } from "react";
import { EthernetIcon, RefreshIcon, WifiIcon } from "../Icons";
import "./AppHeader.css";

type Props = {
  connected: boolean;
  connType?: "wifi" | "ethernet";
  connectionLabel: string;
  refreshing: boolean;
  onRefresh: () => void;
  children?: ReactNode;
};

export default function AppHeader({
  connected,
  connType = "wifi",
  connectionLabel,
  refreshing,
  onRefresh,
  children,
}: Props) {
  return (
    <header className="app-header">
      <div className="header-top">
        <div className="logo">
          <span className="logo-text">K2V</span>
          <span className="logo-subtitle">CityRail</span>
        </div>
        <div className="header-status">
          {connected ? (
            <div className="connection-indicator connected">
              {connType === "wifi" ? <WifiIcon /> : <EthernetIcon />}
              <span>{connectionLabel}</span>
            </div>
          ) : (
            <div className="connection-indicator">
              <WifiIcon />
              <span>{connectionLabel}</span>
            </div>
          )}
          <button
            className={`refresh-button${refreshing ? " refreshing" : ""}`}
            onClick={onRefresh}
            disabled={refreshing}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>
      {children}
    </header>
  );
}
