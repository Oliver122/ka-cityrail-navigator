import LineBadge from "../LineBadge";
import { departureEtaLabel } from "./departureEta";
import { groupByPlatform } from "./groupByPlatform";
import type { StationViewerProps } from "./StationViewerTypes";
import "./StationDeparturesCompact.css";

export default function StationDeparturesCompact({
  stopId,
  departures,
  routeLoadingId,
  onDepartureClick,
}: StationViewerProps) {
  if (departures.length === 0) {
    return (
      <div className="departures-compact">
        <p className="no-departures">No departures</p>
      </div>
    );
  }

  const groups = groupByPlatform(departures);
  const showDividers = groups.length > 1;

  return (
    <div className="departures-compact">
      <div className="departures-compact-rows">
        {groups.map(([platform, platformDeps]) => (
          <div key={platform || "no-platform"} className="platform-group">
            {showDividers && (
              <div className="platform-divider">
                {platform ? `Gleis ${platform}` : "Ohne Gleisangabe"}
              </div>
            )}
            {platformDeps.map((dep, i) => {
              const eta = departureEtaLabel(dep, stopId, routeLoadingId);
              return (
                <div
                  key={i}
                  className="departure-compact-row"
                  onClick={() => onDepartureClick(dep)}
                >
                  <LineBadge line={dep.line} motType={dep.mot_type} size="small" />
                  <div className="compact-main">
                    <span className="compact-destination">{dep.direction}</span>
                    <span className="compact-meta">
                      {dep.platform ? `Gl. ${dep.platform}` : "—"} · {dep.planned_time}
                    </span>
                  </div>
                  <span className={`compact-eta${eta.delayed ? " delayed" : ""}`}>
                    {eta.text}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
