"use client";

/**
 * MonteCarloResults — a finished dispersion run (S12): flight counts
 * (attempted / succeeded / failed), the apogee AGL statistics (mean ± std,
 * P5 / median / P95), the apogee histogram as plain SVG bars (bins from
 * lib/domain/montecarlo), the landing ellipses on a map with a 1σ/2σ/3σ
 * legend, and the KML download.
 */

import type { MonteCarloRunResult } from "@/lib/api";
import { monteCarloKmlUrl } from "@/lib/api";
import { apogeeHistogram, ellipseLayers, flightCounts, type HistogramBin } from "@/lib/domain/montecarlo";
import { formatQuantity, formatNumber } from "@/components/flight/flightMath";
import { buttonClass } from "@/components/ui";
import { LandingEllipseMap } from "@/components/map/LandingEllipseMap";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";

const SUBTITLE = "text-xs font-medium uppercase tracking-[0.06em] text-muted";

export function MonteCarloResults({ runId, result }: { runId: string; result: MonteCarloRunResult }) {
  const t = useT();
  const { locale } = useLocale();
  const counts = flightCounts(result);
  const stats = result.apogee_stats;
  const layers = ellipseLayers(result);
  const m = (value: number) => formatQuantity(value, "m", locale);

  return (
    <div className="flex flex-col gap-5">
      <ul aria-label={t("montecarlo.countsLabel")} className="grid grid-cols-3 gap-2">
        {(
          [
            ["montecarlo.countAttempted", counts.attempted],
            ["montecarlo.countSucceeded", counts.succeeded],
            ["montecarlo.countFailed", counts.failed],
          ] as const
        ).map(([key, value]) => (
          <li key={key} className="flex flex-col gap-0.5 rounded-xl bg-surface-2 px-3 py-2">
            <span className="text-xs text-muted">{t(key)}</span>
            <span className="text-lg font-semibold tabular-nums text-ink">{value}</span>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-2">
        <h3 className={SUBTITLE}>{t("montecarlo.apogeeTitle")}</h3>
        {stats ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div className="flex flex-col">
              <dt className="text-xs text-muted">{t("montecarlo.apogeeMean")}</dt>
              <dd className="tabular-nums text-ink">{t("montecarlo.apogeeMeanValue", { mean: m(stats.mean), std: m(stats.std) })}</dd>
            </div>
            {(
              [
                ["montecarlo.apogeeP5", stats.p5],
                ["montecarlo.apogeeP50", stats.p50],
                ["montecarlo.apogeeP95", stats.p95],
              ] as const
            ).map(([key, value]) => (
              <div key={key} className="flex flex-col">
                <dt className="text-xs text-muted">{t(key)}</dt>
                <dd className="tabular-nums text-ink">{m(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">{t("montecarlo.apogeeNone")}</p>
        )}
      </div>

      {result.apogee_agl.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className={SUBTITLE}>{t("montecarlo.histogramTitle")}</h3>
          <ApogeeHistogram values={result.apogee_agl} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className={SUBTITLE}>{t("montecarlo.mapTitle")}</h3>
        {layers.length > 0 ? (
          <>
            <LandingEllipseMap origin={result.origin} layers={layers} />
            <ul className="flex flex-wrap gap-3 text-xs text-ink-2">
              {layers.map((layer) => (
                <li key={layer.sigma} className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="h-3 w-3 rounded-sm border border-accent bg-accent"
                    style={{ opacity: Math.min(1, layer.fillOpacity * 2.5) }}
                  />
                  {t("montecarlo.sigma", { sigma: formatNumber(layer.sigma, locale) })}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">{t("montecarlo.noEllipse")}</p>
        )}
      </div>

      {result.files.kml && (
        <a href={monteCarloKmlUrl(runId)} download className={buttonClass({ variant: "ghost", className: "self-start" })}>
          {t("montecarlo.downloadKml")}
        </a>
      )}
    </div>
  );
}

const CHART_W = 320;
const CHART_H = 96;

/** Equal-width apogee bins as SVG bars; each bar's range and count is in its tooltip. */
function ApogeeHistogram({ values }: { values: number[] }) {
  const t = useT();
  const { locale } = useLocale();
  const bins = apogeeHistogram(values);
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  const tallest = Math.max(1, ...bins.map((bin) => bin.count));
  const barW = CHART_W / Math.max(1, bins.length);
  const label = (bin: HistogramBin) =>
    t("montecarlo.histogramBar", {
      from: formatNumber(bin.from, locale, 0),
      to: formatQuantity(Math.round(bin.to), "m", locale),
      count: bin.count,
    });
  const first = bins[0];
  const last = bins[bins.length - 1];

  return (
    <figure className="flex flex-col gap-1">
      <svg
        role="img"
        aria-label={t("montecarlo.histogramLabel", { count: total })}
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        preserveAspectRatio="none"
        className="h-24 w-full"
      >
        {bins.map((bin, index) => {
          const h = (bin.count / tallest) * (CHART_H - 2);
          return (
            <rect
              key={index}
              x={index * barW + 1}
              y={CHART_H - h}
              width={Math.max(1, barW - 2)}
              height={h}
              rx={2}
              className="fill-accent"
            >
              <title>{label(bin)}</title>
            </rect>
          );
        })}
      </svg>
      {first && last && (
        <figcaption className="flex justify-between text-xs tabular-nums text-muted">
          <span>{formatQuantity(Math.round(first.from), "m", locale)}</span>
          <span>{formatQuantity(Math.round(last.to), "m", locale)}</span>
        </figcaption>
      )}
    </figure>
  );
}
