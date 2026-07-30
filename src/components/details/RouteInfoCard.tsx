import type { DepartureDetail } from "../../types";
import LineBadge from "../LineBadge";

type Props = {
  departure: DepartureDetail;
};

export default function RouteInfoCard({ departure }: Props) {
  const delayText =
    departure.delayMinutes > 0
      ? `+${departure.delayMinutes} min delay`
      : departure.delayMinutes < 0
        ? `${departure.delayMinutes} min early`
        : "On time";

  return (
    <div className="details-card route-info-card">
      <div className="route-header">
        <LineBadge line={departure.line} motType={departure.motType} size="large" />
        <div className="route-destination">
          <span className="route-direction">{departure.direction}</span>
          <span className="route-from">von {departure.stopName}</span>
        </div>
      </div>

      <div className="route-timing">
        <div className="timing-item">
          <span className="timing-label">Abfahrt</span>
          <span className="timing-value">{departure.realTime}</span>
          {departure.delayMinutes !== 0 && (
            <span className="timing-planned">{departure.plannedTime}</span>
          )}
        </div>
        <div className="timing-item">
          <span className="timing-label">Gleis</span>
          <span className="timing-value">{departure.platform || "-"}</span>
        </div>
        <div className="timing-item">
          <span className="timing-label">Status</span>
          <span
            className={`timing-status ${
              departure.delayMinutes > 0
                ? "status-delayed"
                : departure.delayMinutes < 0
                  ? "status-early"
                  : "status-ontime"
            }`}
          >
            {delayText}
          </span>
        </div>
      </div>
    </div>
  );
}
