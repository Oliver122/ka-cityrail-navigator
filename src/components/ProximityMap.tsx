import { useEffect, useRef, useCallback } from "react";
import { MapContainer, TileLayer, Marker, Popup, CircleMarker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Stop } from "../storage";

// Fix default marker icons in Leaflet + bundler
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

export interface MapBounds {
  north: number;
  south: number;
  east: number;
  west: number;
  center: { lat: number; lon: number };
  radiusKm: number;
}

interface ProximityMapProps {
  userLocation: { lat: number; lon: number } | null;
  stops: Stop[];
  onStopClick?: (stop: Stop) => void;
  onBoundsChange?: (bounds: MapBounds) => void;
  loading?: boolean;
}

// Calculate radius from bounds (approximate)
function boundsToRadius(bounds: L.LatLngBounds): number {
  const center = bounds.getCenter();
  const ne = bounds.getNorthEast();
  // Haversine distance from center to corner
  const R = 6371;
  const dlat = (ne.lat - center.lat) * Math.PI / 180;
  const dlon = (ne.lng - center.lng) * Math.PI / 180;
  const a = Math.sin(dlat / 2) ** 2
    + Math.cos(center.lat * Math.PI / 180) * Math.cos(ne.lat * Math.PI / 180) * Math.sin(dlon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

// Component to handle map events
function MapEventHandler({ onBoundsChange }: { onBoundsChange?: (bounds: MapBounds) => void }) {
  const map = useMap();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const emitBounds = useCallback(() => {
    if (!onBoundsChange) return;
    const bounds = map.getBounds();
    const center = bounds.getCenter();
    onBoundsChange({
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east: bounds.getEast(),
      west: bounds.getWest(),
      center: { lat: center.lat, lon: center.lng },
      radiusKm: boundsToRadius(bounds),
    });
  }, [map, onBoundsChange]);
  
  // Debounced bounds change handler
  const handleBoundsChange = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(emitBounds, 300);
  }, [emitBounds]);
  
  useMapEvents({
    moveend: handleBoundsChange,
    zoomend: handleBoundsChange,
  });
  
  // Emit initial bounds
  useEffect(() => {
    emitBounds();
  }, [emitBounds]);
  
  return null;
}

// Component to recenter map when user location changes
function MapRecenter({ lat, lon }: { lat: number; lon: number }) {
  const map = useMap();
  const hasRecented = useRef(false);
  
  useEffect(() => {
    if (!hasRecented.current) {
      map.setView([lat, lon], 15);
      hasRecented.current = true;
    }
  }, [map, lat, lon]);
  
  return null;
}

// Custom user location icon
const userIcon = L.divIcon({
  className: "user-location-marker",
  html: `<div style="
    width: 16px;
    height: 16px;
    background: #5C6BC0;
    border: 3px solid #e9e6f7;
    border-radius: 50%;
    box-shadow: 0 0 12px rgba(92, 107, 192, 0.6);
  "></div>`,
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

export default function ProximityMap({ userLocation, stops, onStopClick, onBoundsChange, loading }: ProximityMapProps) {
  const center = userLocation ?? { lat: 49.009, lon: 8.404 }; // Default: Karlsruhe
  
  return (
    <div className="proximity-map-container">
      {loading && <div className="map-loading-overlay">Loading stops...</div>}
      <MapContainer
        center={[center.lat, center.lon]}
        zoom={15}
        scrollWheelZoom={true}
        style={{ height: "100%", width: "100%", borderRadius: "0.75rem" }}
      >
        {/* Dark-themed map tiles from CartoDB */}
        <TileLayer
          attribution='&copy; <a href="https://carto.com/">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        />
        
        {/* Event handler for bounds changes */}
        <MapEventHandler onBoundsChange={onBoundsChange} />
        
        {/* Recenter on user location */}
        <MapRecenter lat={center.lat} lon={center.lon} />
        
        {/* User location marker */}
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lon]} icon={userIcon}>
            <Popup className="map-popup">
              <strong>Your Location</strong>
            </Popup>
          </Marker>
        )}
        
        {/* Stop markers */}
        {stops.map((stop) => (
          <CircleMarker
            key={stop.id}
            center={[stop.latitude, stop.longitude]}
            radius={6}
            pathOptions={{
              color: "#0d0d18",
              fillColor: "#a89af8",
              fillOpacity: 0.9,
              weight: 2,
            }}
            eventHandlers={{
              click: () => onStopClick?.(stop),
            }}
          >
            <Popup className="map-popup">
              <strong>{stop.name}</strong>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
