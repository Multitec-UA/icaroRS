/**
 * Pure scenario/wizard domain rules (issue #50).
 *
 * Extracted out of components/wizard/WizardProvider.tsx: which atmosphere
 * models require a launch date, how a `datetime-local` string maps to the
 * hour-granular domain `LaunchDate` without a timezone shift, what shape the
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
// Launch date parsing
// ---------------------------------------------------------------------------

/**
 * Parse a datetime-local string ("2026-06-01T09:54") into a LaunchDate.
 * Parsed literally (NOT via `new Date`) so no local-timezone shift is applied —
 * the domain treats the launch time as UTC.
 */
export function toLaunchDate(iso: string | null): LaunchDate | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3], hour: +m[4] };
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

/** Build the scenario body sent to /api/scenario/validate and /api/simulate. */
export function buildScenarioBody(draft: ScenarioDraft): Record<string, unknown> {
  return {
    name: draft.name,
    site: draft.site,
    date: toLaunchDate(draft.launchDatetime),
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
