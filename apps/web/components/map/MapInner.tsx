"use client";

/**
 * The actual Leaflet map. Loaded ONLY in the browser (via next/dynamic
 * `ssr: false` from SitePicker) because Leaflet touches `window` at import
 * time and would crash server prerendering.
 */

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from "react-leaflet";
import { useEffect } from "react";

// A pure-CSS/SVG pin — avoids bundling Leaflet's default marker PNG assets.
const pinIcon = L.divIcon({
  className: "",
  html: `<svg width="28" height="28" viewBox="0 0 24 24" fill="#0284c7" stroke="white" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" fill="white"/></svg>`,
  iconSize: [28, 28],
  iconAnchor: [14, 28],
});

function ClickHandler({ onPick }: { onPick: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** Recenter the map when the coordinates change from outside (e.g. search). */
function Recenter({ lat, lon }: { lat: number | null; lon: number | null }) {
  const map = useMap();
  useEffect(() => {
    if (lat !== null && lon !== null) {
      map.setView([lat, lon], Math.max(map.getZoom(), 11));
    }
  }, [lat, lon, map]);
  return null;
}

export default function MapInner({
  lat,
  lon,
  onPick,
}: {
  lat: number | null;
  lon: number | null;
  onPick: (lat: number, lon: number) => void;
}) {
  const hasPoint = lat !== null && lon !== null;
  const center: [number, number] = hasPoint ? [lat, lon] : [20, 0];

  return (
    <MapContainer
      center={center}
      zoom={hasPoint ? 11 : 2}
      scrollWheelZoom
      className="h-80 w-full rounded-lg"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onPick={onPick} />
      <Recenter lat={lat} lon={lon} />
      {hasPoint && <Marker position={[lat, lon]} icon={pinIcon} />}
    </MapContainer>
  );
}
