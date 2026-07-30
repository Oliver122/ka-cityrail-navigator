import {
  DetailsHeader,
  RouteInfoCard,
  DisruptionBanner,
  RouteTimeline,
  RouteMap,
} from "./components";
import type { DepartureDetail } from "./types";
import "./DepartureDetails.css";

interface Props {
  departure: DepartureDetail;
  onBack: () => void;
}

export default function DepartureDetails({ departure, onBack }: Props) {
  return (
    <main className="details-page">
      <DetailsHeader onBack={onBack} />

      <RouteInfoCard departure={departure} />

      {departure.disruption && (
        <DisruptionBanner message={departure.disruption} />
      )}

      <div className="details-card">
        <h2 className="card-title">Route Progress</h2>
        <RouteTimeline stops={departure.routeStops} />
      </div>

      {departure.routeStops.length > 0 && departure.routeStops.some((s) => s.latitude != null) && (
        <div className="details-card route-map-card">
          <h2 className="card-title">Route Map</h2>
          <RouteMap
            routeStops={departure.routeStops}
            routePath={departure.routePath}
            currentStopName={departure.stopName}
          />
        </div>
      )}
    </main>
  );
}
