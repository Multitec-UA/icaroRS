/**
 * Pure scenario/wizard domain rules (issue #50).
 *
 * Extracted out of components/wizard/WizardProvider.tsx: which atmosphere
 * models require a launch date, how a `datetime-local` string typed in the
 * user's time zone maps to the hour-granular UTC domain `LaunchDate`, what shape the
 * API expects for validate/simulate, and which step transitions are allowed.
 *
 * Plain functions over plain data — no React, no context. Mirrors
 * packages/icaro/icaro/scenario.py; apps/web can't import the Python package
 * directly (see the monorepo's AGENTS.md), so this is the necessary
 * client-side mirror, kept isolated and unit-testable instead of embedded in
 * a context provider.
 */

import type {
  Atmosphere,
  AtmosphereModel,
  LaunchDate,
  Site,
  SimulateResult,
} from "@/lib/api";
import { CHANGE_GROUPS, type ChangeGroup } from "./runs";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type WizardStep = "rocket" | "basics" | "advanced" | "review" | "results";

export const STEP_ORDER: WizardStep[] = [
  "rocket",
  "basics",
  "advanced",
  "review",
  "results",
];

/** Atmosphere models that require a launch date (and an internet fetch). */
export function needsDate(model: AtmosphereModel): boolean {
  return model === "forecast" || model === "wyoming_sounding";
}

export const DEFAULT_ATMOSPHERE: Atmosphere = {
  model: "standard_atmosphere",
  file: null,
  station: null,
  fallback: "standard_atmosphere",
};

// ---------------------------------------------------------------------------
// Launch date: user's wall clock <-> UTC domain date
// ---------------------------------------------------------------------------

/**
 * Time zone used when the browser does not report a usable one. The team and
 * its launch sites are in Spain, so this is the least surprising default.
 */
export const FALLBACK_TIME_ZONE = "Europe/Madrid";

function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * The IANA time zone the launch-time picker is expressed in: the browser's
 * own zone, or FALLBACK_TIME_ZONE when the browser reports none or an
 * unknown one.
 */
export function resolveTimeZone(): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timeZone && isValidTimeZone(timeZone)) return timeZone;
  } catch {
    // Fall through to the fallback zone.
  }
  return FALLBACK_TIME_ZONE;
}

/** Offset of `timeZone` from UTC, in milliseconds, at the instant `utcMs`. */
function zoneOffsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return wallAsUtc - utcMs;
}

/**
 * Parse a datetime-local string ("2026-06-01T09:54"), read as a wall-clock
 * time in `timeZone`, into the UTC LaunchDate the domain expects.
 *
 * The domain is hour-granular: minutes are dropped after converting to UTC,
 * so a zone with a half-hour offset lands on the UTC hour that started
 * before the chosen instant.
 */
export function toLaunchDate(
  local: string | null,
  timeZone: string = resolveTimeZone(),
): LaunchDate | null {
  if (!local) return null;
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):?(\d{2})?/);
  if (!m) return null;
  const wallAsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], m[5] ? +m[5] : 0);
  // Two passes: the offset at the guessed instant can differ from the offset
  // at the real one when the wall clock sits next to a DST change.
  let utcMs = wallAsUtc - zoneOffsetMs(wallAsUtc, timeZone);
  utcMs = wallAsUtc - zoneOffsetMs(utcMs, timeZone);
  const utc = new Date(utcMs);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour: utc.getUTCHours(),
  };
}

/** Serialize a UTC LaunchDate as an ISO 8601 string with an explicit offset. */
export function launchDateToIso(date: LaunchDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.year}-${pad(date.month)}-${pad(date.day)}T${pad(date.hour)}:00:00+00:00`;
}

/** Render a UTC LaunchDate as a wall-clock time in `timeZone`, with its zone name. */
export function formatLaunchDate(
  date: LaunchDate,
  locale: string,
  timeZone: string = resolveTimeZone(),
): string {
  const instant = new Date(Date.UTC(date.year, date.month - 1, date.day, date.hour));
  return instant.toLocaleString(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
    timeZoneName: "short",
  });
}

// ---------------------------------------------------------------------------
// Scenario body (validate/simulate payload)
// ---------------------------------------------------------------------------

/**
 * Launch rail values the user typed over the file's own (S4). A key is
 * present only while that field is overridden; Reset deletes it.
 */
export type RailOverrides = Partial<Record<"length" | "inclination" | "heading", number>>;

/** The subset of the wizard draft needed to build the API payload. */
export interface ScenarioDraft {
  name: string;
  site: Site | null;
  launchDatetime: string | null;
  atmosphere: Atmosphere;
  railOverrides: RailOverrides;
}

/**
 * Build the scenario body sent to /api/scenario/validate and /api/simulate.
 * `draft.launchDatetime` is the user's wall clock in `timeZone`; the body
 * carries it converted to UTC.
 *
 * `rail` carries ONLY the overridden fields and is omitted when none is:
 * the core falls back to the export's own `flight` values per missing key,
 * so the file's defaults are never frozen into a run. `uncertainty` is always
 * empty: the simulate use-case does not read it (S5).
 */
export function buildScenarioBody(
  draft: ScenarioDraft,
  timeZone: string = resolveTimeZone(),
): Record<string, unknown> {
  const rail = Object.fromEntries(
    Object.entries(draft.railOverrides).filter(([, value]) => typeof value === "number"),
  );
  return {
    name: draft.name,
    site: draft.site,
    date: toLaunchDate(draft.launchDatetime, timeZone),
    atmosphere: draft.atmosphere,
    ...(Object.keys(rail).length > 0 ? { rail } : {}),
    uncertainty: {},
  };
}

// ---------------------------------------------------------------------------
// Canonical scenario and diff (S6: "stale is real")
// ---------------------------------------------------------------------------

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function round(value: unknown, decimals: number): unknown {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  const factor = 10 ** decimals;
  // `+ 0` folds -0 into 0, so a rounded -0.000001 equals 0.
  return Math.round(value * factor) / factor + 0;
}

/** Recursively rebuild `value` with sorted object keys; `undefined` keys are dropped. */
function sortKeys(value: unknown): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return (value ?? null) as Json;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/**
 * The comparable form of a scenario body — the one sent to /api/simulate
 * or the one a run stored. Two bodies that would simulate the same flight
 * yield the same canonical form:
 *   - object keys sorted at every level;
 *   - coordinates rounded to 5 decimals (about a metre), elevation to 1;
 *   - `rail` holds only the keys that carry a value and is absent when none
 *     does (an override that was reset, or a stored `rail: null`);
 *   - `uncertainty` is dropped: the simulate use-case ignores it (S5).
 */
export function canonicalScenario(body: unknown): Record<string, Json> {
  const source = isRecord(body) ? { ...body } : {};
  delete source.uncertainty;

  if (isRecord(source.site)) {
    const site = source.site;
    source.site = {
      ...site,
      latitude: round(site.latitude, 5),
      longitude: round(site.longitude, 5),
      ...("elevation" in site ? { elevation: round(site.elevation, 1) } : {}),
    };
  }

  const rail = isRecord(source.rail)
    ? Object.fromEntries(Object.entries(source.rail).filter(([, value]) => typeof value === "number"))
    : {};
  if (Object.keys(rail).length > 0) source.rail = rail;
  else delete source.rail;

  return sortKeys(source) as Record<string, Json>;
}

/** What decides a run: the export it simulates and the scenario it was sent. */
export interface RunReference {
  exportId: string | null;
  scenario: unknown;
}

const GROUP_FIELD: Record<Exclude<ChangeGroup, "file">, string> = {
  site: "site",
  date: "date",
  weather: "atmosphere",
  rail: "rail",
};

/**
 * The input groups that differ between two runs' inputs, in the fixed
 * order file, site, date, weather, rail; empty when they would simulate the
 * same flight. Compares canonical forms, so key order, sub-metre noise and
 * uncertainty never count as a change.
 */
export function scenarioDiff(a: RunReference, b: RunReference): ChangeGroup[] {
  const ca = canonicalScenario(a.scenario);
  const cb = canonicalScenario(b.scenario);
  return CHANGE_GROUPS.filter((group) =>
    group === "file"
      ? a.exportId !== b.exportId
      : JSON.stringify(ca[GROUP_FIELD[group]] ?? null) !== JSON.stringify(cb[GROUP_FIELD[group]] ?? null),
  );
}

// ---------------------------------------------------------------------------
// Step-advance guard
// ---------------------------------------------------------------------------

/** The subset of wizard progress needed to decide whether "Next" is enabled. */
export interface ScenarioProgress {
  exportId: string | null;
  site: Site | null;
  atmosphere: Atmosphere;
  launchDatetime: string | null;
  result: SimulateResult | null;
}

/** A site the simulation can place: both coordinates are finite numbers. */
function hasFiniteSite(site: Site | null): site is Site {
  return site !== null && Number.isFinite(site.latitude) && Number.isFinite(site.longitude);
}

/** True when the atmosphere model needs a launch date and none is parseable. */
function missesRequiredDate(progress: Pick<ScenarioProgress, "atmosphere" | "launchDatetime">): boolean {
  return needsDate(progress.atmosphere.model) && toLaunchDate(progress.launchDatetime) === null;
}

/** The subset of the draft the Workbench's Run button depends on. */
export type RunReadiness = Pick<
  ScenarioProgress,
  "exportId" | "site" | "atmosphere" | "launchDatetime"
>;

/**
 * True when the Workbench can send the draft to /api/simulate: an export is
 * loaded, the launch site is placed, and a launch date exists whenever the
 * atmosphere model needs one. Local gate for fast feedback only — the API
 * still validates the scenario (same contract as `canAdvance`).
 */
export function canRun(progress: RunReadiness): boolean {
  return progress.exportId !== null && hasFiniteSite(progress.site) && !missesRequiredDate(progress);
}

/**
 * True when the current step's local guard is satisfied — gates the "Next"
 * button for fast UX feedback only. The API (/api/scenario/validate,
 * /api/simulate) remains the single source of truth for correctness; this
 * never decides a scenario is valid on its own.
 */
export function canAdvance(step: WizardStep, progress: ScenarioProgress): boolean {
  switch (step) {
    case "rocket":
      return progress.exportId !== null;
    case "basics":
      return hasFiniteSite(progress.site) && !missesRequiredDate(progress);
    case "advanced":
      return true; // advanced overrides are all optional
    case "review":
      return progress.result !== null; // only after a successful simulate
    case "results":
      return false;
    default:
      return false;
  }
}
