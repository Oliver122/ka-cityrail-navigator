import type { Stop } from "../../storage";
import ProximityMap, { type MapBounds } from "../ProximityMap";
import "./ProximityMapCard.css";

type Props = {
  userLocation: { lat: number; lon: number } | null;
  stops: Stop[];
  loading?: boolean;
  onBoundsChange?: (bounds: MapBounds) => void;
  onStopClick?: (stop: Stop) => void;
};

export default function ProximityMapCard({
  userLocation,
  stops,
  loading,
  onBoundsChange,
  onStopClick,
}: Props) {
  return (
    <div className="map-card">
      <div className="map-header">
        <span className="map-title">Proximity Map</span>
        <span className="map-stop-count">
          {loading ? "Loading..." : `${stops.length} stops in view`}
        </span>
      </div>
      <ProximityMap
        userLocation={userLocation}
        stops={stops}
        loading={loading}
        onBoundsChange={onBoundsChange}
        onStopClick={onStopClick}
      />
    </div>
  );
}
