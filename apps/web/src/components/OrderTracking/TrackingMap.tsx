import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import type { TrackingLocation } from "@/types/orderTracking";

function FitBounds({
  points,
}: {
  points: Array<[number, number]>;
}) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView(points[0], 14);
      return;
    }
    map.fitBounds(points, { padding: [24, 24] });
  }, [map, points]);
  return null;
}

const TrackingMap = ({
  storeLocation,
  deliveryLocation,
  riderLocation,
}: {
  storeLocation?: TrackingLocation;
  deliveryLocation?: TrackingLocation;
  riderLocation?: TrackingLocation;
}) => {
  const points = useMemo(
    () =>
      [storeLocation, deliveryLocation, riderLocation]
        .filter((l): l is TrackingLocation => !!l?.latitude && !!l?.longitude)
        .map((l): [number, number] => [l.latitude, l.longitude]),
    [storeLocation, deliveryLocation, riderLocation],
  );

  if (points.length === 0) return null;

  const center = points[0];

  return (
    <MapContainer
      center={center}
      zoom={14}
      className="z-0 h-48 w-full overflow-hidden rounded-lg border"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {storeLocation?.latitude && (
        <CircleMarker
          center={[storeLocation.latitude, storeLocation.longitude]}
          radius={10}
          pathOptions={{ color: "#047857", fillColor: "#10b981", fillOpacity: 0.9 }}
        >
          <Popup>Store</Popup>
        </CircleMarker>
      )}
      {deliveryLocation?.latitude && (
        <CircleMarker
          center={[deliveryLocation.latitude, deliveryLocation.longitude]}
          radius={10}
          pathOptions={{ color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 0.9 }}
        >
          <Popup>Delivery address</Popup>
        </CircleMarker>
      )}
      {riderLocation?.latitude && (
        <CircleMarker
          center={[riderLocation.latitude, riderLocation.longitude]}
          radius={8}
          pathOptions={{ color: "#b45309", fillColor: "#f59e0b", fillOpacity: 0.9 }}
        >
          <Popup>Rider&#39;s live location</Popup>
        </CircleMarker>
      )}
    </MapContainer>
  );
};

export default TrackingMap;