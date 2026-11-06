"use client";

/**
 * The Leaflet map of a dispersion run's landing ellipses (S12). Loaded ONLY
 * in the browser (next/dynamic `ssr: false` from LandingEllipseMap), like
 * MapInner: Leaflet touches `window` at import time.
 *
 * The launch site is a pin; each ellipse is a Polygon, the 1σ one most
 * opaque. The view fits the outermost ellipse and the site.
 */

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { MapContainer, Marker, Polygon, TileLayer, useMap } from "react-leaflet";
import { useEffect } from "react";
import { useT } from "@/components/i18n/LocaleProvider";
import type { EllipseLayer } from "@/lib/domain/montecarlo";

// Same theme-token pin as MapInner (no Leaflet marker PNGs to bundle).
const pinIcon = L.divIcon({
  className: "",
  html: `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" style="fill:var(--accent);stroke:var(--ink)" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" style="fill:var(--surface)"/></svg>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
});

const ELLIPSE_CLASS = "[stroke:var(--accent)] [fill:var(--accent)]";

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 1) map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
  }, [map, points]);
  return null;
}

export default function LandingEllipseMapInner({
  origin,
  layers,
}: {
  origin: { latitude: number; longitude: number };
  layers: EllipseLayer[];
}) {
  const t = useT();
  const site: [number, number] = [origin.latitude, origin.longitude];
  const points = [site, ...(layers[layers.length - 1]?.positions ?? [])];

  return (
    <MapContainer center={site} zoom={13} scrollWheelZoom={false} className="h-72 w-full rounded-lg">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {/* Outermost first, so the inner ellipses draw on top. */}
      {[...layers].reverse().map((layer) => (
        <Polygon
          key={layer.sigma}
          positions={layer.positions}
          // Colours come from the theme tokens through CSS (it beats Leaflet's
          // presentation attributes); only the per-sigma opacity is an option.
          pathOptions={{ className: ELLIPSE_CLASS, weight: 1.5, fillOpacity: layer.fillOpacity }}
        />
      ))}
      <Marker position={site} icon={pinIcon} keyboard={false} title={t("montecarlo.launchSite")} />
    </MapContainer>
  );
}
