/**
 * Pure rules behind the "Real flight" card (real-flight-compare S6): what
 * each chart, KPI and event row shows when a run is compared with a real
 * MT1 flight. No React, no DOM, so the card stays thin and these stay
 * unit-testable. Every value comes from the API in SI units; the card
 * converts to the unit system in effect.
 */

import type { ComparisonEvent, ComparisonKpi, FlightComparison, RealFlightSummary } from "@/lib/api";
import type { MeasureKind } from "@/lib/units";

/** The three overlays, in display order, and what each one measures. */
export const COMPARE_CHARTS: { key: "alt_m" | "vz_ms" | "acc_ms2"; kind: MeasureKind; labelKey: string }[] = [
  { key: "alt_m", kind: "length", labelKey: "realflight.chartAltitude" },
  { key: "vz_ms", kind: "speed", labelKey: "realflight.chartVerticalSpeed" },
  { key: "acc_ms2", kind: "acceleration", labelKey: "realflight.chartAcceleration" },
];

export type CompareChartKey = (typeof COMPARE_CHARTS)[number]["key"];

/** KPI ids in display order with what they measure. Unknown ids are not shown. */
const KPI_KINDS: Record<string, MeasureKind> = {
  apogee_m: "length",
  apogee_t: "time",
  vmax_ms: "speed",
  landing_t: "time",
  amax_ms2: "acceleration",
};

const RMSE_KINDS: Record<CompareChartKey, MeasureKind> = {
  alt_m: "length",
  vz_ms: "speed",
  acc_ms2: "acceleration",
};

/** Event ids the table names, in flight order (contract v1 minus liftoff). */
export const EVENT_ORDER = ["rail_exit", "burnout", "apogee", "ejection", "deploy", "landing"] as const;

/** Warning codes the card translates; any other code shows the API's English message. */
export const KNOWN_WARNINGS = [
  "sim_approximate",
  "site_far",
  "pad_unknown",
  "single_deploy",
  "no_overlap",
  "real_ends_early",
  "missing_alt_m",
  "missing_vz_ms",
  "missing_acc_ms2",
] as const;

export interface ChartData {
  t: number[];
  sim: (number | null)[];
  real: (number | null)[];
}

/** One overlay's samples, or null when neither side has the series. */
export function chartData(comparison: FlightComparison, key: CompareChartKey): ChartData | null {
  const sim = comparison.series.sim[key];
  const real = comparison.series.real[key];
  if (!sim && !real) return null;
  const n = comparison.series.t.length;
  const empty = () => new Array<number | null>(n).fill(null);
  return { t: comparison.series.t, sim: sim ?? empty(), real: real ?? empty() };
}

/** Finite min/max over both sides, padded so a flat line is still drawable. */
export function valueRange(data: ChartData): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const side of [data.sim, data.real]) {
    for (const v of side) {
      if (typeof v === "number" && Number.isFinite(v)) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min)) return null;
  // Keep zero on the axis when the data is all on one side of it (altitude,
  // acceleration): the reader compares heights, not wiggles.
  if (min > 0) min = 0;
  if (max < 0) max = 0;
  if (max === min) max = min + 1;
  return { min, max };
}

/** The peak of a side (largest finite value), or null. */
export function peak(values: (number | null)[]): number | null {
  let best: number | null = null;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && (best === null || v > best)) best = v;
  }
  return best;
}

/**
 * An SVG path through the samples, broken where a value is missing (a side
 * outside its own time range), with at most `maxPoints` vertices.
 */
export function linePath(
  t: number[],
  values: (number | null)[],
  sx: (t: number) => number,
  sy: (v: number) => number,
  maxPoints = 400,
): string {
  const n = Math.min(t.length, values.length);
  const stride = Math.max(1, Math.ceil(n / maxPoints));
  const parts: string[] = [];
  let pen = false;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const isLast = i === n - 1;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      pen = false;
      continue;
    }
    // Keep the first sample after a gap and the last sample, whatever the stride.
    if (pen && i % stride !== 0 && !isLast) continue;
    parts.push(`${pen ? "L" : "M"}${sx(t[i]).toFixed(1)},${sy(v).toFixed(1)}`);
    pen = true;
  }
  return parts.join(" ");
}

export interface KpiRow {
  id: string;
  kind: MeasureKind;
  sim: number | null;
  real: number | null;
  delta: number | null;
  deltaPct: number | null;
}

/** KPI rows in display order: apogee, time to apogee, vmax, landing time, peak acceleration. */
export function kpiRows(kpis: ComparisonKpi[]): KpiRow[] {
  const byId = new Map(kpis.map((k) => [k.id, k]));
  return Object.entries(KPI_KINDS)
    .map(([id, kind]) => {
      const k = byId.get(id);
      if (!k) return null;
      return {
        id,
        kind,
        sim: k.sim ?? null,
        real: k.real ?? null,
        delta: k.delta ?? null,
        deltaPct: k.delta_pct ?? null,
      };
    })
    .filter((row): row is KpiRow => row !== null && (row.sim !== null || row.real !== null));
}

/** RMSE rows that have a value, in chart order. */
export function rmseRows(rmse: FlightComparison["rmse"]): { key: CompareChartKey; kind: MeasureKind; value: number }[] {
  return COMPARE_CHARTS.flatMap(({ key }) => {
    const value = rmse[key];
    return typeof value === "number" && Number.isFinite(value) ? [{ key, kind: RMSE_KINDS[key], value }] : [];
  });
}

export interface EventRow extends ComparisonEvent {
  /** 1-based position among rows with the same id, when there are several (two deploys). */
  ordinal: number | null;
}

/** Event rows in flight order, numbered when an id repeats. */
export function eventRows(events: ComparisonEvent[]): EventRow[] {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.id, (counts.get(e.id) ?? 0) + 1);
  const seen = new Map<string, number>();
  const rank = (id: string) => {
    const i = (EVENT_ORDER as readonly string[]).indexOf(id);
    return i === -1 ? EVENT_ORDER.length : i;
  };
  return [...events]
    .sort((a, b) => rank(a.id) - rank(b.id))
    .map((e) => {
      const index = (seen.get(e.id) ?? 0) + 1;
      seen.set(e.id, index);
      return { ...e, ordinal: (counts.get(e.id) ?? 0) > 1 ? index : null };
    });
}

/** A signed number for deltas: "+12.3", "−4.1", "0" (true minus sign). */
export function signed(formatted: string, value: number): string {
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `−${formatted.replace(/^[-−]/, "")}`;
  return formatted;
}

/** The picker's option text: "MT1 · MT1-00279-9a1a6300 · 18 Oct 2026 · 459 m". */
export function flightOptionParts(
  flight: RealFlightSummary,
  formatDate: (iso: string) => string,
  formatApogee: (metres: number) => string,
): string[] {
  const parts: string[] = [];
  if (flight.rocket) parts.push(flight.rocket);
  parts.push(flight.flight_id);
  if (flight.launch_utc) {
    const date = formatDate(flight.launch_utc);
    if (date) parts.push(date);
  }
  const apogee = flight.stats?.apogee_m;
  if (typeof apogee === "number" && Number.isFinite(apogee)) parts.push(formatApogee(apogee));
  return parts;
}

/** The i18n key of a warning, or null when the card shows the API's message. */
export function warningKey(code: string): string | null {
  return (KNOWN_WARNINGS as readonly string[]).includes(code) ? `realflight.warning.${code}` : null;
}
