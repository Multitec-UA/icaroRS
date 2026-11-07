"use client";

/**
 * The Leaflet map of a dispersion run (S12). Loaded ONLY in the browser
 * (next/dynamic `ssr: false` from LandingEllipseMap), like MapInner: Leaflet
 * touches `window` at import time.
 *
 * Esri World Imagery satellite tiles. Bottom to top: the apogee ellipses
 * (green, dashed), the landing ellipses (accent), one small dot per landing
 * point, then the launch-site pin. Each ellipse is a Polygon, the 1σ one most
 * opaque; their colours come from theme tokens through CSS classes. The dots
 * share one canvas renderer so hundreds of points stay smooth; canvas ignores
 * CSS, so they use fixed white-on-dark, readable on any imagery. The view fits
 * the site, the outer ellipses and every point.
 */

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { CircleMarker, MapContainer, Marker, Polygon, TileLayer, useMap } from "react-leaflet";
import { useEffect, useMemo } from "react";
import { useT } from "@/components/i18n/LocaleProvider";
import type { EllipseLayer } from "@/lib/domain/montecarlo";

// Same theme-token pin as MapInner (no Leaflet marker PNGs to bundle).
const pinIcon = L.divIcon({
  className: "",
  html: `<svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" style="fill:var(--accent);stroke:var(--ink)" stroke-width="1.5" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5" style="fill:var(--surface)"/></svg>`,
  iconSize: [24, 24],
  iconAnchor: [12, 24],
});

// Colours come from the theme tokens through CSS (it beats Leaflet's
// presentation attributes); only the per-sigma opacity is an option.
const LANDING_CLASS = "[stroke:var(--accent)] [fill:var(--accent)]";
const APOGEE_CLASS = "[stroke:var(--ok)] [fill:var(--ok)]";
const POINT_STYLE = { color: "#111827", weight: 1, fillColor: "#ffffff", fillOpacity: 0.9 };

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
  apogeeLayers,
  impacts,
}: {
  origin: { latitude: number; longitude: number };
  layers: EllipseLayer[];
  apogeeLayers: EllipseLayer[];
  impacts: [number, number][];
}) {
  const t = useT();
  const site: [number, number] = [origin.latitude, origin.longitude];
  const points = useMemo(
    () => [
      [origin.latitude, origin.longitude] as [number, number],
      ...(layers[layers.length - 1]?.positions ?? []),
      ...(apogeeLayers[apogeeLayers.length - 1]?.positions ?? []),
      ...impacts,
    ],
    [origin.latitude, origin.longitude, layers, apogeeLayers, impacts],
  );
  const pointRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  return (
    <MapContainer center={site} zoom={13} scrollWheelZoom={false} className="h-72 w-full rounded-lg">
      <TileLayer
        attribution="Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
        url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
        maxZoom={19}
      />
      <FitBounds points={points} />
      {/* Outermost first, so the inner ellipses draw on top. */}
      {[...apogeeLayers].reverse().map((layer) => (
        <Polygon
          key={`apogee-${layer.sigma}`}
          positions={layer.positions}
          interactive={false}
          pathOptions={{ className: APOGEE_CLASS, weight: 1.5, dashArray: "6 4", fillOpacity: layer.fillOpacity }}
        />
      ))}
      {[...layers].reverse().map((layer) => (
        <Polygon
          key={`landing-${layer.sigma}`}
          positions={layer.positions}
          interactive={false}
          pathOptions={{ className: LANDING_CLASS, weight: 1.5, fillOpacity: layer.fillOpacity }}
        />
      ))}
      {impacts.map((position, index) => (
        <CircleMarker
          key={index}
          center={position}
          radius={3}
          interactive={false}
          pathOptions={{ ...POINT_STYLE, renderer: pointRenderer }}
        />
      ))}
      <Marker position={site} icon={pinIcon} keyboard={false} title={t("montecarlo.launchSite")} />
    </MapContainer>
  );
}
