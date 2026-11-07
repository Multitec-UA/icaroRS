/**
 * Monte Carlo dispersion (S12): the pure rules the Workbench and /runs share
 * to launch a run, follow it and present its result. No React, no i18n: the
 * components turn these numbers into words.
 *
 * The API (S9) bounds a web run to 10..500 flights and runs one job at a time
 * per instance; a run reports `queued` (with the number of runs ahead of it),
 * `running` (with `done / total` flights), then `done` or `error`.
 */

import type { MonteCarloRunResult, MonteCarloStatus } from "@/lib/api";
import { fromSi, unitLabel, type MeasureKind, type UnitSystem } from "@/lib/units";

export const MC_MIN_FLIGHTS = 10;
export const MC_MAX_FLIGHTS = 500;
export const MC_DEFAULT_FLIGHTS = 100;
/** Measured wall time of one flight through the API's worker (500 ≈ 3–4 min). */
export const MC_SECONDS_PER_FLIGHT = 0.4;
/** How often a queued or running run is asked for its progress. */
export const MC_POLL_MS = 2000;
/** Bars of the apogee histogram. */
export const MC_HISTOGRAM_BINS = 12;

/** A flight count the API accepts: rounded and clamped; anything else is the default. */
export function clampFlights(value: number): number {
  if (!Number.isFinite(value)) return MC_DEFAULT_FLIGHTS;
  return Math.min(MC_MAX_FLIGHTS, Math.max(MC_MIN_FLIGHTS, Math.round(value)));
}

/** Whole minutes `n` flights take on the API, rounded up, at least one ("≈ N min"). */
export function estimateMinutes(flights: number): number {
  return Math.max(1, Math.ceil((flights * MC_SECONDS_PER_FLIGHT) / 60));
}

export function isMonteCarloActive(status: MonteCarloStatus | undefined): boolean {
  return status === "queued" || status === "running";
}

/** TanStack Query's `refetchInterval`: poll while active, stop once done or failed. */
export function monteCarloPollInterval(status: MonteCarloStatus | undefined): number | false {
  return isMonteCarloActive(status) ? MC_POLL_MS : false;
}

/** Progress as a 0..1 fraction for the bar. */
export function progressFraction(progress: { done: number; total: number }): number {
  if (!(progress.total > 0)) return 0;
  return Math.min(1, Math.max(0, progress.done / progress.total));
}

/** Runs ahead in the instance's queue (the API's `queue_position`; 0 = next). */
export function queueAhead(position: number | null | undefined): number {
  return position && position > 0 ? position : 0;
}

export interface HistogramBin {
  from: number;
  to: number;
  count: number;
}

/**
 * Equal-width bins over min..max of the finite values; the maximum falls in
 * the last bin. Identical values make one bin; no values make none.
 */
export function apogeeHistogram(values: readonly number[], bins = MC_HISTOGRAM_BINS): HistogramBin[] {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return [];
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return [{ from: min, to: max, count: finite.length }];
  const count = Math.max(1, Math.floor(bins));
  const width = (max - min) / count;
  const result: HistogramBin[] = Array.from({ length: count }, (_, i) => ({
    from: min + i * width,
    to: i === count - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const value of finite) {
    const index = Math.min(count - 1, Math.floor((value - min) / width));
    result[index].count += 1;
  }
  return result;
}

/** An API polygon (`[lat, lon]` pairs) as Leaflet positions, malformed points dropped. */
export function ellipsePositions(polygon: readonly (readonly number[])[]): [number, number][] {
  return polygon
    .filter((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
    .map((point) => [point[0], point[1]]);
}

export interface EllipseLayer {
  sigma: number;
  positions: [number, number][];
  fillOpacity: number;
}

/** The landing ellipses with their sigma, the inner (1σ) one most opaque. */
export function ellipseLayers(
  result: Pick<MonteCarloRunResult, "ellipse_sigmas" | "landing_ellipses">,
): EllipseLayer[] {
  return result.ellipse_sigmas
    .map((sigma, index) => ({
      sigma,
      positions: ellipsePositions(result.landing_ellipses[index] ?? []),
      fillOpacity: Math.max(0.08, 0.36 / (index + 1)),
    }))
    .filter((layer) => layer.positions.length >= 3);
}

export function flightCounts(result: Pick<MonteCarloRunResult, "n_requested" | "n_succeeded" | "n_failed">) {
  return { attempted: result.n_requested, succeeded: result.n_succeeded, failed: result.n_failed };
}

// ---------------------------------------------------------------------------
// Explaining a finished run (S15)
// ---------------------------------------------------------------------------

export type UncertaintyBudget = MonteCarloRunResult["uncertainty"];

/** A dispersed input as shown to the reader: `angles` = inclination and heading with the same std. */
export interface BudgetItem {
  key: "mass" | "thrust" | "wind_factor" | "inclination" | "heading" | "angles" | "rail_length";
  amount: number;
  unit: string;
}

const BUDGET_ORDER = ["mass", "thrust", "wind_factor", "inclination", "heading", "rail_length"] as const;
/** The unit of an `absolute` std, per input (a `relative` one is a fraction, shown as %). */
const ABSOLUTE_UNITS: Record<(typeof BUDGET_ORDER)[number], string> = {
  mass: "kg",
  thrust: "N",
  wind_factor: "",
  inclination: "°",
  heading: "°",
  rail_length: "m",
};

/** At most two decimals, and none when they are noise (0.03 × 100 = 3.0000000000000004). */
function tidy(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The budget the run actually dispersed, in reading order and display units:
 * relative stds as percentages, absolute ones in the input's unit. Missing or
 * unknown keys are left out; an empty budget (runs stored before S15) has no
 * items. Inclination and heading with the same amount read as one `angles` item.
 */
export function budgetItems(uncertainty: UncertaintyBudget | null | undefined): BudgetItem[] {
  if (!uncertainty) return [];
  const items: BudgetItem[] = [];
  for (const key of BUDGET_ORDER) {
    const entry = uncertainty[key];
    if (!entry || !Number.isFinite(entry.std)) continue;
    items.push(
      entry.kind === "relative"
        ? { key, amount: tidy(entry.std * 100), unit: "%" }
        : { key, amount: tidy(entry.std), unit: ABSOLUTE_UNITS[key] },
    );
  }
  const inclination = items.findIndex((item) => item.key === "inclination");
  const heading = items[inclination + 1];
  if (
    inclination >= 0 &&
    heading?.key === "heading" &&
    heading.amount === items[inclination].amount &&
    heading.unit === items[inclination].unit
  ) {
    items.splice(inclination, 2, { key: "angles", amount: heading.amount, unit: heading.unit });
  }
  return items;
}

/** The metric units of an absolute spread that convert with the unit system. */
const BUDGET_UNIT_KINDS: Record<string, MeasureKind> = { kg: "mass", m: "length" };

/**
 * A budget item in `system`: an absolute mass or rail-length spread converted
 * (kg → lb, m → ft) with the same two-decimal tidying; %, ° and N unchanged.
 */
export function budgetItemIn(item: BudgetItem, system: UnitSystem): BudgetItem {
  const kind = BUDGET_UNIT_KINDS[item.unit];
  if (!kind || system === "metric") return item;
  return { ...item, amount: tidy(fromSi(item.amount, kind, system)), unit: unitLabel(kind, system) };
}

export const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

/**
 * The mean impact point as a distance and an 8-point compass direction from
 * the launch site (`impact_x` east, `impact_y` north, metres). The distance
 * is in the length unit of `system` (m or ft), whole units, rounded to 10
 * from 100 up ("about 120 m", "about 390 ft"). Null without a finite impact.
 */
export function landingSummary(
  impactX: readonly number[],
  impactY: readonly number[],
  system: UnitSystem = "metric",
): { distance: number; direction: CompassPoint } | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let i = 0; i < Math.min(impactX.length, impactY.length); i++) {
    if (!Number.isFinite(impactX[i]) || !Number.isFinite(impactY[i])) continue;
    sumX += impactX[i];
    sumY += impactY[i];
    count += 1;
  }
  if (count === 0) return null;
  const x = sumX / count;
  const y = sumY / count;
  const raw = fromSi(Math.hypot(x, y), "length", system);
  const distance = raw >= 100 ? Math.round(raw / 10) * 10 : Math.round(raw);
  const bearing = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  return { distance, direction: COMPASS_POINTS[Math.round(bearing / 45) % 8] };
}

/** Share of landings inside the kσ ellipse of a 2-D normal: 1 − e^(−k²/2) (39 %, 86 %, 99 %). */
export function ellipseCoverage(sigma: number): number {
  return 1 - Math.exp(-(sigma * sigma) / 2);
}
