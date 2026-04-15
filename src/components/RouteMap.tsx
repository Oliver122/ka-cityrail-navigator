import { useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { RouteStop } from "../types";

interface RouteMapProps {
  routeStops: RouteStop[];
  routePath?: string;
  currentStopName?: string;
}

function parsePath(path: string): [number, number][] {
  if (!path) return [];
  return path
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [lonStr, latStr] = pair.split(",");
      const lon = parseFloat(lonStr);
      const lat = parseFloat(latStr);
      return isNaN(lon) || isNaN(lat) ? null : [lat, lon] as [number, number];
    })
    .filter((p): p is [number, number] => p !== null);
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useMemo(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points);
      map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 });
    }
  }, [map, points]);
  return null;
}

export default function RouteMap({ routeStops, routePath, currentStopName }: RouteMapProps) {
  const pathPoints = useMemo(() => parsePath(routePath ?? ""), [routePath]);
  const stopPoints: { pos: [number, number]; stop: RouteStop }[] = useMemo(
    () =>
      routeStops
        .filter((s) => s.latitude != null && s.longitude != null)
        .map((s) => ({ pos: [s.latitude!, s.longitude!] as [number, number], stop: s })),
    [routeStops],
  );

  const allPoints = pathPoints.length > 0 ? pathPoints : stopPoints.map((s) => s.pos);
  if (allPoints.length === 0) return null;

  const defaultCenter = allPoints[Math.floor(allPoints.length / 2)];

  return (
    <div className="route-map-container">
      <MapContainer
        center={defaultCenter}
        zoom={13}
        scrollWheelZoom={true}
        dragging={true}
        style={{ height: "100%", width: "100%", borderRadius: "0.75rem" }}
      >
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        <FitBounds points={allPoints} />

        {pathPoints.length > 0 && (
          <Polyline
            positions={pathPoints}
            pathOptions={{ color: "#a89af8", weight: 3, opacity: 0.8 }}
          />
        )}

        {stopPoints.map(({ pos, stop }) => {
          const isCurrent = stop.name === currentStopName;
          return (
            <CircleMarker
              key={stop.id}
              center={pos}
              radius={isCurrent ? 7 : 5}
              pathOptions={{
                color: isCurrent ? "#e9e6f7" : "#0d0d18",
                fillColor: isCurrent ? "#a89af8" : "#6b6880",
                fillOpacity: 1,
                weight: isCurrent ? 3 : 2,
              }}
            >
              <Popup className="map-popup">
                <strong>{stop.name}</strong>
                {stop.arrivalTime && <br />}
                {stop.arrivalTime && <span>{stop.arrivalTime}</span>}
              </Popup>
            </CircleMarker>
          );
        })}
      </MapContainer>
    </div>
  );
}
