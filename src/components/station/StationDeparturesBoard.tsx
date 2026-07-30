import { useState } from "react";
import LineBadge from "../LineBadge";
import { ChevronDownIcon, ChevronUpIcon } from "../Icons";
import { formatCountdown } from "../../utils/time";
import { departureRowId } from "./departureEta";
import { groupByPlatform } from "./groupByPlatform";
import type { StationViewerProps } from "./StationViewerTypes";
import "./StationDeparturesBoard.css";

export default function StationDeparturesBoard({
  stopId,
  departures,
  routeLoadingId,
  onDepartureClick,
}: StationViewerProps) {
  const [collapsedPlatforms, setCollapsedPlatforms] = useState<Set<string>>(
    () => new Set(),
  );

  if (departures.length === 0) {
    return (
      <div className="departures-board">
        <p className="no-departures">No departures</p>
      </div>
    );
  }

  const groups = groupByPlatform(departures);
  const showDividers = groups.length > 1;

  const togglePlatform = (key: string) => {
    setCollapsedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="departures-board">
      <div className="departures-board-rows">
        {groups.map(([platform, platformDeps]) => {
          const key = platform || "no-platform";
          const label = platform ? `Gleis ${platform}` : "Ohne Gleisangabe";
          const collapsed = showDividers && collapsedPlatforms.has(key);

          return (
            <div key={key} className="platform-group">
              {showDividers && (
                <button
                  type="button"
                  className={`platform-divider platform-divider-toggle${collapsed ? " collapsed" : ""}`}
                  onClick={() => togglePlatform(key)}
                  aria-expanded={!collapsed}
                >
                  <span className="platform-divider-label">{label}</span>
                  <span className="platform-divider-meta">
                    {platformDeps.length}
                    {collapsed ? <ChevronDownIcon /> : <ChevronUpIcon />}
                  </span>
                </button>
              )}
              {!collapsed &&
                platformDeps.map((dep, i) => {
                  const loading = routeLoadingId === departureRowId(stopId, dep);
                  const etaText = loading
                    ? "…"
                    : formatCountdown(dep.countdown, dep.real_time).text;
                  const delay = dep.delay_minutes > 0 ? dep.delay_minutes : 0;

                  return (
                    <div
                      key={`${dep.line}-${dep.planned_time}-${i}`}
                      className="departure-board-row"
                      onClick={() => onDepartureClick(dep)}
                    >
                      <div className="board-time">
                        <span className={`board-eta${delay > 0 ? " delayed" : ""}`}>
                          {etaText}
                        </span>
                        {delay > 0 && (
                          <span className="board-delay" title={`${delay} min delay`}>
                            +{delay}
                          </span>
                        )}
                      </div>
                      <div className="board-main">
                        <div className="board-line-row">
                          <LineBadge line={dep.line} motType={dep.mot_type} size="large" />
                          <span className="board-destination">{dep.direction}</span>
                        </div>
                        <span className="board-meta">plan {dep.planned_time}</span>
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
