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
