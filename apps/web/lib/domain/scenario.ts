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
  Dispersion,
  LaunchDate,
  Rail,
  Site,
  SimulateResult,
} from "@/lib/api";

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

/** The subset of the wizard draft needed to build the API payload. */
export interface ScenarioDraft {
  name: string;
  site: Site | null;
  launchDatetime: string | null;
  atmosphere: Atmosphere;
  rail: Rail | null;
  uncertainty: Record<string, Dispersion> | null;
}

/**
 * Build the scenario body sent to /api/scenario/validate and /api/simulate.
 * `draft.launchDatetime` is the user's wall clock in `timeZone`; the body
 * carries it converted to UTC.
 */
export function buildScenarioBody(
  draft: ScenarioDraft,
  timeZone: string = resolveTimeZone(),
): Record<string, unknown> {
  return {
    name: draft.name,
    site: draft.site,
    date: toLaunchDate(draft.launchDatetime, timeZone),
    atmosphere: draft.atmosphere,
    rail: draft.rail,
    uncertainty: draft.uncertainty,
  };
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
      return (
        progress.site !== null &&
        Number.isFinite(progress.site.latitude) &&
        Number.isFinite(progress.site.longitude) &&
        (!needsDate(progress.atmosphere.model) ||
          toLaunchDate(progress.launchDatetime) !== null)
      );
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
