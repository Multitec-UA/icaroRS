"use client";

/**
 * LandingEllipseMap — a dispersion run's landing ellipses on a map (S12).
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
}: {
  origin: { latitude: number; longitude: number };
  layers: EllipseLayer[];
}) {
  const t = useT();
  return (
    <div role="region" aria-label={t("montecarlo.mapLabel")} className="isolate">
      <LandingEllipseMapInner origin={origin} layers={layers} />
    </div>
  );
}
