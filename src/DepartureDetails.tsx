import { ChevronLeftIcon, ShareIcon, MenuIcon, AlertIcon, MapIcon } from "./components/Icons";
import LineBadge from "./components/LineBadge";
import type { DepartureDetail, RouteStop } from "./types";
import "./DepartureDetails.css";

interface Props {
  departure: DepartureDetail;
  onBack: () => void;
}

function RouteTimeline({ stops }: { stops: RouteStop[] }) {
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
              {stop.arrivalTime && (
                <span className={stop.delayMinutes && stop.delayMinutes > 0 ? "time-delayed" : ""}>
                  {stop.arrivalTime}
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

export default function DepartureDetails({ departure, onBack }: Props) {
  const delayText = departure.delayMinutes > 0 
    ? `+${departure.delayMinutes} min delay` 
    : departure.delayMinutes < 0 
      ? `${departure.delayMinutes} min early`
      : "On time";

  return (
    <main className="details-page">
      <header className="details-header">
        <button className="icon-button" onClick={onBack}>
          <ChevronLeftIcon />
        </button>
        <h1>Departure Details</h1>
        <div className="header-actions">
          <button className="icon-button">
            <ShareIcon />
          </button>
          <button className="icon-button">
            <MenuIcon />
          </button>
        </div>
      </header>

      {/* Route Info Card */}
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
            <span className={`timing-status ${departure.delayMinutes > 0 ? "status-delayed" : departure.delayMinutes < 0 ? "status-early" : "status-ontime"}`}>
              {delayText}
            </span>
          </div>
        </div>
      </div>

      {/* Disruption Banner */}
      {departure.disruption && (
        <div className="disruption-banner">
          <AlertIcon className="disruption-icon" />
          <span>{departure.disruption}</span>
        </div>
      )}

      {/* Route Progress */}
      <div className="details-card">
        <h2 className="card-title">Route Progress</h2>
        <RouteTimeline stops={departure.routeStops} />
      </div>

      {/* Map Button */}
      <button className="map-button">
        <MapIcon />
        <span>View Full Route Map</span>
      </button>
    </main>
  );
}
