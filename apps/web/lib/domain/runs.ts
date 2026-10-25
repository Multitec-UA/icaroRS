/**
 * Pure helpers behind /runs and the run report (S9): the four numbers two
 * runs are compared on, their deltas against a baseline, the "What changed"
 * diff of two runs' inputs, and the plain facts a stored scenario states.
 * No React and no catalog here — the components format and label what these
 * return, so the runs table, the chips and the report share one reading of
 * the data.
 */

import type { SimulationSummary } from "@/lib/api";
import type { Locale } from "@/lib/i18n";

// ---------------------------------------------------------------------------
// Metrics and deltas
// ---------------------------------------------------------------------------

export interface RunMetrics {
  /** Apogee above ground, metres. */
  apogee: number | null;
  /** Maximum speed, m/s. */
  maxSpeed: number | null;
  /** Total flight time, seconds. */
  flightTime: number | null;
  /** Landing distance from the pad, metres (√(x² + y²) of the impact offsets). */
  landing: number | null;
}

export type RunMetricKey = keyof RunMetrics;

export const RUN_METRIC_KEYS: RunMetricKey[] = ["apogee", "maxSpeed", "flightTime", "landing"];

export const RUN_METRIC_UNITS: Record<RunMetricKey, string> = {
  apogee: "m",
  maxSpeed: "m/s",
  flightTime: "s",
  landing: "m",
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The compared numbers of a run, from its scalars. History rows carry the
 * result scalars (`apogee_m`, …) plus a top-level `apogee` alias, which is
 * the only number a run saved before the full scalar set may have.
 */
export function runMetrics(scalars: unknown): RunMetrics {
  const s = record(scalars) ?? {};
  const east = finite(s.impact_x_m);
  const north = finite(s.impact_y_m);
  return {
    apogee: finite(s.apogee_m) ?? finite(s.apogee),
    maxSpeed: finite(s.max_velocity_ms),
    flightTime: finite(s.flight_time_s),
    landing: east !== null && north !== null ? Math.hypot(east, north) : null,
  };
}

/** Run minus baseline, per metric; null wherever either side is missing. */
export function runDeltas(baseline: RunMetrics, run: RunMetrics): RunMetrics {
  const delta = (key: RunMetricKey) => {
    const a = baseline[key];
    const b = run[key];
    return a === null || b === null ? null : b - a;
  };
  return {
    apogee: delta("apogee"),
    maxSpeed: delta("maxSpeed"),
    flightTime: delta("flightTime"),
    landing: delta("landing"),
  };
}

/** Decimals that keep a readout honest without noise: 3,142 · 27.3 · 1.93. */
function fractionDigitsFor(value: number): number {
  const abs = Math.abs(value);
  return abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
}

/** `+74 m`, `-1,235 m`, `0 m`: always signed except for zero, locale-grouped. */
export function formatDelta(delta: number, locale: Locale, unit = ""): string {
  const num = new Intl.NumberFormat(locale, {
    signDisplay: "exceptZero",
    maximumFractionDigits: fractionDigitsFor(delta),
  }).format(delta);
  return unit ? `${num} ${unit}` : num;
}

// ---------------------------------------------------------------------------
// Scenario facts
// ---------------------------------------------------------------------------

export interface ScenarioSite {
  latitude: number;
  longitude: number;
  elevation: number | null;
}

export interface ScenarioRail {
  length: number | null;
  inclination: number | null;
  heading: number | null;
}

export interface ScenarioFacts {
  /** The scenario's own name, trimmed; null when blank. */
  name: string | null;
  site: ScenarioSite | null;
  /** The launch hour as an ISO instant in UTC (`2026-11-07T11:00:00Z`). */
  launchDateIso: string | null;
  /** The atmosphere model id (`forecast`, `standard_atmosphere`, …). */
  model: string | null;
  rail: ScenarioRail | null;
  /** Whether the run set any uncertainty spread at all. */
  hasUncertainty: boolean;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function launchDateIso(date: Record<string, unknown> | null): string | null {
  if (!date) return null;
  const year = finite(date.year);
  const month = finite(date.month);
  const day = finite(date.day);
  const hour = finite(date.hour);
  if (year === null || month === null || day === null || hour === null) return null;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:00:00Z`;
}

/** What a stored scenario says, tolerant of partial or legacy shapes. */
export function scenarioFacts(scenario: unknown): ScenarioFacts {
  const s = record(scenario) ?? {};
  const name = typeof s.name === "string" && s.name.trim() ? s.name.trim() : null;
  const site = record(s.site);
  const latitude = finite(site?.latitude);
  const longitude = finite(site?.longitude);
  const atmosphere = record(s.atmosphere);
  const rail = record(s.rail);
  const uncertainty = record(s.uncertainty);
  return {
    name,
    site:
      latitude !== null && longitude !== null
        ? { latitude, longitude, elevation: finite(site?.elevation) }
        : null,
    launchDateIso: launchDateIso(record(s.date)),
    model: typeof atmosphere?.model === "string" ? atmosphere.model : null,
    rail: rail
      ? { length: finite(rail.length), inclination: finite(rail.inclination), heading: finite(rail.heading) }
      : null,
    hasUncertainty: uncertainty !== null && Object.keys(uncertainty).length > 0,
  };
}

/** `38.3452, -0.481` — the coordinates as stored, for labels and chips. */
export function siteLabel(site: ScenarioSite): string {
  return `${site.latitude}, ${site.longitude}`;
}

// ---------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------

export type RunChangeKey =
  | "site"
  | "launchDate"
  | "atmosphere"
  | "railLength"
  | "railInclination"
  | "railHeading"
  | "uncertainty"
  | "file";

export interface RunChange {
  key: RunChangeKey;
  /** Raw "before" value (unformatted); null when unset or when the key has no single value. */
  from: string | null;
  /** Raw "after" value, same convention. */
  to: string | null;
}

/** The inputs that decide a run: its scenario and the file it simulated. */
export type RunInputs = Pick<SimulationSummary, "scenario" | "ork_filename" | "export_id">;

function str(value: number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** JSON with sorted keys at every level, so equal spreads compare equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const obj = record(value);
  if (!obj) return JSON.stringify(value) ?? "";
  return `{${Object.keys(obj)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`)
    .join(",")}}`;
}

/**
 * Every input of `run` that differs from `baseline`, in a fixed order: site,
 * launch date, atmosphere model, the three rail values, the uncertainty
 * spread (reported without values — a whole table changed) and the file. A
 * run of a different export is a different file even when the names match.
 */
export function whatChanged(baseline: RunInputs, run: RunInputs): RunChange[] {
  const a = scenarioFacts(baseline.scenario);
  const b = scenarioFacts(run.scenario);
  const changes: RunChange[] = [];
  const push = (key: RunChangeKey, from: string | null, to: string | null) => {
    if (from !== to) changes.push({ key, from, to });
  };

  push("site", a.site ? siteLabel(a.site) : null, b.site ? siteLabel(b.site) : null);
  push("launchDate", a.launchDateIso, b.launchDateIso);
  push("atmosphere", a.model, b.model);
  push("railLength", str(a.rail?.length), str(b.rail?.length));
  push("railInclination", str(a.rail?.inclination), str(b.rail?.inclination));
  push("railHeading", str(a.rail?.heading), str(b.rail?.heading));

  const baseSpread = stableJson(record(baseline.scenario)?.uncertainty ?? null);
  const runSpread = stableJson(record(run.scenario)?.uncertainty ?? null);
  if (baseSpread !== runSpread) changes.push({ key: "uncertainty", from: null, to: null });

  if (baseline.export_id !== run.export_id || baseline.ork_filename !== run.ork_filename) {
    changes.push({ key: "file", from: baseline.ork_filename, to: run.ork_filename });
  }
  return changes;
}

/** The last characters of a run id for compact labels; short ids stay whole. */
export function shortRunId(runId: string): string {
  return runId.length <= 10 ? runId : runId.slice(-6);
}
