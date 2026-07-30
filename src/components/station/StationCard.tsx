import type { ReactNode } from "react";
import { ChevronDownIcon, ChevronUpIcon, StarIcon, WifiIcon } from "../Icons";
import "./StationCard.css";

type Props = {
  stopId: string;
  name: string;
  distanceLabel: string | null;
  starred: boolean;
  networkPinned: boolean;
  showNetworkPin: boolean;
  collapsed: boolean;
  temporary?: boolean;
  networkSsid?: string;
  onToggleCollapse: () => void;
  onToggleStar: () => void;
  onToggleNetworkPin: () => void;
  children?: ReactNode;
};

export default function StationCard({
  stopId,
  name,
  distanceLabel,
  starred,
  networkPinned,
  showNetworkPin,
  collapsed,
  temporary = false,
  networkSsid,
  onToggleCollapse,
  onToggleStar,
  onToggleNetworkPin,
  children,
}: Props) {
  return (
    <section
      id={`station-${stopId}`}
      className={`station-card${starred ? " starred" : ""}${networkPinned ? " network-pinned" : ""}${temporary ? " temporary" : ""}`}
    >
      <div className="station-header" onClick={onToggleCollapse}>
        <button
          className={`star-button${starred ? " active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleStar();
          }}
        >
          <StarIcon filled={starred} />
        </button>
        {showNetworkPin && (
          <button
            className={`network-pin-button${networkPinned ? " active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleNetworkPin();
            }}
            title={networkPinned ? "Remove network pin" : `Pin to ${networkSsid ?? "network"}`}
          >
            <WifiIcon />
          </button>
        )}
        <div className="station-info">
          <span className="station-name">{name}</span>
          {temporary && <span className="station-temp-badge">Temp</span>}
          {distanceLabel !== null && (
            <span className="station-distance">{distanceLabel}</span>
          )}
        </div>
        <button className="collapse-button">
          {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
        </button>
      </div>
      {!collapsed && children}
    </section>
  );
}
