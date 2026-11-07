"use client";

/**
 * LandingEllipseMap — a dispersion run on a satellite map (S12): landing
 * ellipses, apogee ellipses and every landing point.
 * The Leaflet part is dynamically imported with `ssr: false`, as SitePicker
 * does with MapInner; tests mock this module because Leaflet needs `window`.
 */

import dynamic from "next/dynamic";
import { useT } from "@/components/i18n/LocaleProvider";
import type { EllipseLayer } from "@/lib/domain/montecarlo";

function MapLoadingFallback() {
  const t = useT();
  return (
    <div className="flex h-72 w-full items-center justify-center rounded-lg border border-border bg-surface-2 text-sm text-muted">
      {t("montecarlo.mapLoading")}
    </div>
  );
}

const LandingEllipseMapInner = dynamic(() => import("./LandingEllipseMapInner"), {
  ssr: false,
  loading: MapLoadingFallback,
});

export function LandingEllipseMap({
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
  return (
    <div role="region" aria-label={t("montecarlo.mapLabel")} className="isolate">
      <LandingEllipseMapInner origin={origin} layers={layers} apogeeLayers={apogeeLayers} impacts={impacts} />
    </div>
  );
}
