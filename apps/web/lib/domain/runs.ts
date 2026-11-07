/**
 * Pure helpers behind /runs and the run report (S9): the four numbers two
 * runs are compared on, their deltas against a baseline, the "What changed"
 * diff of two runs' inputs, and the plain facts a stored scenario states.
 * No React and no catalog here — the components format and label what these
 * return, so the runs table, the chips and the report share one reading of
 * the data.
 */

import { fileLabel } from "./exports";
import type { SimulationSummary } from "@/lib/api";
import type { Locale } from "@/lib/i18n";
import type { MeasureKind } from "@/lib/units";
import { canonicalScenario, scenarioDiff, type ChangeGroup } from "./scenario";

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

/** What each compared number measures; the table converts values and deltas with it. */
export const RUN_METRIC_KINDS: Record<RunMetricKey, MeasureKind> = {
  apogee: "length",
  maxSpeed: "speed",
  flightTime: "time",
  landing: "length",
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

/**
 * What a stored run's scenario says about its launch. The scenario's `name`
 * is deliberately absent: the Workbench never asks for one and sends a
 * default label ("my_scenario"), so the site is what names a launch.
 */
export interface ScenarioFacts {
  site: ScenarioSite | null;
  /** The launch hour as an ISO instant in UTC (`2026-11-07T11:00:00Z`). */
  launchDateIso: string | null;
  /** The atmosphere model id (`forecast`, `standard_atmosphere`, …). */
  model: string | null;
  rail: ScenarioRail | null;
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
  const site = record(s.site);
  const latitude = finite(site?.latitude);
  const longitude = finite(site?.longitude);
  const atmosphere = record(s.atmosphere);
  const rail = record(s.rail);
  return {
    site:
      latitude !== null && longitude !== null
        ? { latitude, longitude, elevation: finite(site?.elevation) }
        : null,
    launchDateIso: launchDateIso(record(s.date)),
    model: typeof atmosphere?.model === "string" ? atmosphere.model : null,
    rail: rail
      ? { length: finite(rail.length), inclination: finite(rail.inclination), heading: finite(rail.heading) }
      : null,
  };
}

/** `38.3452, -0.481` — the coordinates as stored, for labels and chips. */
/** 5 decimals is about 1 m: the precision canonicalScenario compares sites at. */
function coordinate(value: number): string {
  return String(Number(value.toFixed(5)));
}

export function siteLabel(site: ScenarioSite): string {
  return `${coordinate(site.latitude)}, ${coordinate(site.longitude)}`;
}

// ---------------------------------------------------------------------------
// What changed
// ---------------------------------------------------------------------------

export type RunChangeKey =
  | "file"
  | "site"
  | "elevation"
  | "launchDate"
  | "atmosphere"
  | "fallback"
  | "station"
  | "railLength"
  | "railInclination"
  | "railHeading"
  /** The group changed in a field that has no chip of its own. */
  | "other";

/**
 * The five groups the inputs of a run fall into (S6). One diff decides both
 * surfaces: `scenarioDiff` (./scenario) names the changed groups for the
 * Workbench status, and `whatChanged` details each change within them for
 * `/runs`. Both render the same chip (components/runs/WhatChanged
 * `ChangeChip`).
 */
export { CHANGE_GROUPS, type ChangeGroup } from "./scenario";

export interface RunChange {
  group: ChangeGroup;
  key: RunChangeKey;
  /** Raw "before" value (unformatted); null when unset or when the key has no single value. */
  from: string | null;
  /** Raw "after" value, same convention. */
  to: string | null;
}

/** The inputs that decide a run: its scenario and the file it simulated. */
export type RunInputs = Pick<SimulationSummary, "scenario" | "ork_filename" | "export_id"> &
  Partial<Pick<SimulationSummary, "ork_revision">>;

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** `scenario[field]`, or `scenario[field][key]` when a key is given; null when absent. */
function at(scenario: Record<string, unknown>, field: string, key?: string): unknown {
  const group = scenario[field];
  if (key === undefined) return group ?? null;
  return record(group)?.[key] ?? null;
}

/** The site's coordinates as one label (`38.3452, -0.481`); null without both. */
function coordinates(scenario: Record<string, unknown>): string | null {
  const latitude = finite(at(scenario, "site", "latitude"));
  const longitude = finite(at(scenario, "site", "longitude"));
  return latitude === null || longitude === null ? null : siteLabel({ latitude, longitude, elevation: null });
}

/**
 * Every input of `run` that differs from `baseline` (S12a), detailed within
 * the groups `scenarioDiff` reports — so `/runs` and the Workbench status
 * agree on what changed. Fixed order: file, site (coordinates, elevation),
 * date, weather (model, fallback, station), rail (length, inclination,
 * heading). Values come from the canonical forms, so key order, sub-metre
 * noise and uncertainty never count. A group that changed in a field with no
 * chip of its own still gets one `other` chip. A run of a different export
 * is a different file even when the names match.
 */
export function whatChanged(baseline: RunInputs, run: RunInputs): RunChange[] {
  const a = canonicalScenario(baseline.scenario);
  const b = canonicalScenario(run.scenario);
  const groups = scenarioDiff(
    { exportId: baseline.export_id, scenario: baseline.scenario },
    { exportId: run.export_id, scenario: run.scenario },
  );
  const changes: RunChange[] = [];

  for (const group of groups) {
    const before = changes.length;
    const push = (key: RunChangeKey, from: string | null, to: string | null) => {
      if (from !== to) changes.push({ group, key, from, to });
    };
    switch (group) {
      case "file":
        // Two imports of one file name differ by their version (v1 → v3).
        changes.push({
          group,
          key: "file",
          from: baseline.ork_filename ? fileLabel(baseline.ork_filename, baseline.ork_revision) : null,
          to: run.ork_filename ? fileLabel(run.ork_filename, run.ork_revision) : null,
        });
        break;
      case "site":
        push("site", coordinates(a), coordinates(b));
        push("elevation", text(at(a, "site", "elevation")), text(at(b, "site", "elevation")));
        break;
      case "date":
        push("launchDate", launchDateIso(record(at(a, "date"))), launchDateIso(record(at(b, "date"))));
        break;
      case "weather":
        push("atmosphere", text(at(a, "atmosphere", "model")), text(at(b, "atmosphere", "model")));
        push("fallback", text(at(a, "atmosphere", "fallback")), text(at(b, "atmosphere", "fallback")));
        push("station", text(at(a, "atmosphere", "station")), text(at(b, "atmosphere", "station")));
        break;
      case "rail":
        push("railLength", text(at(a, "rail", "length")), text(at(b, "rail", "length")));
        push("railInclination", text(at(a, "rail", "inclination")), text(at(b, "rail", "inclination")));
        push("railHeading", text(at(a, "rail", "heading")), text(at(b, "rail", "heading")));
        break;
    }
    if (changes.length === before) changes.push({ group, key: "other", from: null, to: null });
  }
  return changes;
}

/** The last characters of a run id for compact labels; short ids stay whole. */
export function shortRunId(runId: string): string {
  return runId.length <= 10 ? runId : runId.slice(-6);
}
