import LineBadge from "../LineBadge";
import { departureEtaLabel } from "./departureEta";
import { groupByPlatform } from "./groupByPlatform";
import type { StationViewerProps } from "./StationViewerTypes";
import "./StationDeparturesTable.css";

export type { StationViewerProps } from "./StationViewerTypes";

export default function StationDeparturesTable({
  stopId,
  departures,
  routeLoadingId,
  onDepartureClick,
}: StationViewerProps) {
  if (departures.length === 0) {
    return (
      <div className="departures-table">
        <p className="no-departures">No departures</p>
      </div>
    );
  }

  const groups = groupByPlatform(departures);
  const showDividers = groups.length > 1;

  return (
    <div className="departures-table">
      <div className="departures-header">
        <span className="col-line">Line</span>
        <span className="col-destination">Destination</span>
        <span className="col-platform">Pl.</span>
        <span className="col-scheduled">Sched.</span>
        <span className="col-eta">ETA</span>
      </div>
      <div className="departures-rows-wrapper">
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
                  className="departure-row"
                  onClick={() => onDepartureClick(dep)}
                >
                  <span className="col-line">
                    <LineBadge line={dep.line} motType={dep.mot_type} />
                  </span>
                  <span className="col-destination">{dep.direction}</span>
                  <span className="col-platform">{dep.platform || "-"}</span>
                  <span className="col-scheduled">{dep.planned_time}</span>
                  <span className={`col-eta ${eta.delayed ? "delayed" : ""}`}>
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
