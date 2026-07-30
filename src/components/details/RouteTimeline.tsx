import type { RouteStop } from "../../types";

type Props = {
  stops: RouteStop[];
};

export default function RouteTimeline({ stops }: Props) {
  return (
    <div className="route-timeline">
      {stops.map((stop, index) => (
        <div key={stop.id} className={`timeline-stop timeline-stop-${stop.status}`}>
          <div className="timeline-line-container">
            {index > 0 && <div className="timeline-line timeline-line-top" />}
            <div className="timeline-dot" />
            {index < stops.length - 1 && <div className="timeline-line timeline-line-bottom" />}
          </div>
          <div className="timeline-content">
            <div className="timeline-stop-info">
              <span className="timeline-stop-name">{stop.name}</span>
              {stop.platform && <span className="timeline-platform">Gl. {stop.platform}</span>}
            </div>
            <div className="timeline-time">
              {(stop.arrivalTime || stop.departureTime) && (
                <span className={stop.delayMinutes && stop.delayMinutes > 0 ? "time-delayed" : ""}>
                  {stop.arrivalTime || stop.departureTime}
                  {stop.delayMinutes && stop.delayMinutes > 0 && (
                    <span className="delay-badge">+{stop.delayMinutes}</span>
                  )}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
