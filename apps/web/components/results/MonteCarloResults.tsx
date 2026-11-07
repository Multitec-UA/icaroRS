"use client";

/**
 * MonteCarloResults — a finished dispersion run (S12): flight counts
 * (attempted / succeeded / failed), the apogee AGL statistics (mean ± std,
 * P5 / median / P95), the apogee histogram as plain SVG bars (bins from
 * lib/domain/montecarlo), the landing ellipses (1σ/2σ/3σ), the apogee
 * ellipses and every landing point on a satellite map with its legend, and
 * the KML download.
 *
 * S15 explains it for first-year students: a context line built from the
 * budget the run dispersed, an automatic reading of this run's numbers, an
 * InfoTip on every block and a collapsed "How to read these results".
 */

import type { MonteCarloRunResult } from "@/lib/api";
import { monteCarloKmlUrl } from "@/lib/api";
import {
  apogeeEllipseLayers,
  apogeeHistogram,
  budgetItemIn,
  budgetItems,
  ellipseCoverage,
  ellipseLayers,
  flightCounts,
  impactPositions,
  landingSummary,
  type BudgetItem,
  type EllipseLayer,
  type HistogramBin,
} from "@/lib/domain/montecarlo";
import type { Locale } from "@/lib/i18n";
import { plural } from "@/lib/i18n";
import { InfoTip } from "@/components/InfoTip";
import { formatMeasureQuantity, formatNumber, formatQuantity } from "@/components/flight/flightMath";
import { buttonClass } from "@/components/ui";
import { LandingEllipseMap } from "@/components/map/LandingEllipseMap";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import { MonteCarloExplainer } from "./MonteCarloExplainer";

const SUBTITLE = "flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] text-muted";

/** "±5 %", "±2°", "±0.02 m" (or "±0.07 ft"): a budget amount with its unit. */
function budgetAmount(item: BudgetItem, locale: Locale): string {
  const value = formatNumber(item.amount, locale, 2);
  if (!item.unit) return `±${value}`;
  return item.unit === "°" ? `±${value}°` : `±${value} ${item.unit}`;
}

/** What the run varied, from the budget it actually dispersed (S15). */
function ContextLine({ result }: { result: MonteCarloRunResult }) {
  const t = useT();
  const { locale } = useLocale();
  const { system } = useUnits();
  const items = budgetItems(result.uncertainty).map((item) => budgetItemIn(item, system));
  const count = result.n_requested;
  const text =
    items.length > 0
      ? t("montecarlo.contextBudget", {
          count,
          list: new Intl.ListFormat(locale, { type: "conjunction" }).format(
            items.map((item) => t(`montecarlo.budget.${item.key}`, { amount: budgetAmount(item, locale) })),
          ),
        })
      : t("montecarlo.contextDefault", { count });
  return <p className="text-sm leading-relaxed text-ink-2">{text}</p>;
}

/** This run in words (S15): apogee range, most likely landing point, failed flights. */
function Reading({ result, layers }: { result: MonteCarloRunResult; layers: EllipseLayer[] }) {
  const t = useT();
  const { locale } = useLocale();
  const { system, label } = useUnits();
  const stats = result.apogee_stats;
  if (!stats) return <p className="text-sm text-ink">{t("montecarlo.readNone")}</p>;
  const m = (value: number) => formatMeasureQuantity(value, "length", system, locale);
  // Already in the length unit of `system`, rounded "about" in that unit.
  const landing = landingSummary(result.impact_x, result.impact_y, system);
  const outer = layers[layers.length - 1];
  const sentences = [t("montecarlo.readApogee", { p5: m(stats.p5), p95: m(stats.p95), p50: m(stats.p50) })];
  if (landing) {
    const vars = { distance: formatQuantity(landing.distance, label("length"), locale), direction: t(`montecarlo.direction.${landing.direction}`) };
    sentences.push(
      outer
        ? t("montecarlo.readLandingEllipse", { ...vars, coverage: Math.round(ellipseCoverage(outer.sigma) * 100) })
        : t("montecarlo.readLanding", vars),
    );
  }
  if (result.n_failed > 0) sentences.push(plural(locale, result.n_failed, "montecarlo.readFailed"));
  return (
    <div className="flex flex-col gap-1 text-sm leading-relaxed text-ink">
      {sentences.map((sentence) => (
        <p key={sentence}>{sentence}</p>
      ))}
    </div>
  );
}

export function MonteCarloResults({ runId, result }: { runId: string; result: MonteCarloRunResult }) {
  const t = useT();
  const { locale } = useLocale();
  const counts = flightCounts(result);
  const stats = result.apogee_stats;
  const layers = ellipseLayers(result);
  const apogeeLayers = apogeeEllipseLayers(result);
  const impacts = impactPositions(result);
  const { system } = useUnits();
  const m = (value: number) => formatMeasureQuantity(value, "length", system, locale);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <ContextLine result={result} />
        <Reading result={result} layers={layers} />
        <MonteCarloExplainer />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className={SUBTITLE}>
          {t("montecarlo.countsLabel")}
          <InfoTip term="mc_counts" />
        </h3>
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
      </div>

      <div className="flex flex-col gap-2">
        <h3 className={SUBTITLE}>
          {t("montecarlo.apogeeTitle")}
          <InfoTip term="mc_apogee_stats" />
        </h3>
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
          <h3 className={SUBTITLE}>
            {t("montecarlo.histogramTitle")}
            <InfoTip term="mc_histogram" />
          </h3>
          <ApogeeHistogram values={result.apogee_agl} />
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className={SUBTITLE}>
          {t("montecarlo.mapTitle")}
          <InfoTip term="mc_ellipses" />
        </h3>
        {layers.length > 0 ? (
          <>
            <LandingEllipseMap origin={result.origin} layers={layers} apogeeLayers={apogeeLayers} impacts={impacts} />
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
              {apogeeLayers.length > 0 && (
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="h-3 w-3 rounded-sm border border-dashed border-ok bg-ok-soft" />
                  {t("montecarlo.legendApogee")}
                </li>
              )}
              {impacts.length > 0 && (
                <li className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full border border-ink bg-surface" />
                  {t("montecarlo.legendPoints")}
                </li>
              )}
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
  const { display, label: unitOf } = useUnits();
  // Binned on the values in the unit system in effect, so the axis reads in m or ft.
  const bins = apogeeHistogram(values.map((value) => display(value, "length")));
  const unit = unitOf("length");
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  const tallest = Math.max(1, ...bins.map((bin) => bin.count));
  const barW = CHART_W / Math.max(1, bins.length);
  const label = (bin: HistogramBin) =>
    t("montecarlo.histogramBar", {
      from: formatNumber(bin.from, locale, 0),
      to: formatQuantity(Math.round(bin.to), unit, locale),
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
          <span>{formatQuantity(Math.round(first.from), unit, locale)}</span>
          <span>{formatQuantity(Math.round(last.to), unit, locale)}</span>
        </figcaption>
      )}
    </figure>
  );
}
