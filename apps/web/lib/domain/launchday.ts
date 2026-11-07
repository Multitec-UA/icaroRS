/**
 * Pure rules of the launch-day advisor (launch-day S6): wind units, compass
 * points, the recommendation headline and the L1 checklist status. Labels
 * and translations are the components' job.
 */

import type { LaunchCandidate, LaunchCheck, LaunchCheckId } from "@/lib/api/launchday";
import { fromSi, type MeasureKind, type UnitSystem } from "@/lib/units";
import { COMPASS_POINTS, type CompassPoint } from "./montecarlo";

/** The sweep the API runs when the request names no grid (S3). */
export const DEFAULT_INCLINATIONS = [90, 88, 86, 84, 82, 80] as const;
export const DEFAULT_HEADINGS = Array.from({ length: 12 }, (_, i) => i * 30);
export const DEFAULT_FLIGHT_COUNT = DEFAULT_INCLINATIONS.length * DEFAULT_HEADINGS.length;

/** Bounds of the manual wind inputs. */
export const WIND_MAX_KMH = 60;
export const DIRECTION_MAX = 359;

/** Rows of the candidates table. */
export const TOP_CANDIDATES = 8;

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor + 0;
}

/** km/h → m/s, to the millimetre per second. */
export function kmhToMs(kmh: number): number {
  return roundTo(kmh / 3.6, 3);
}

/** m/s → km/h, to one decimal. */
export function msToKmh(ms: number): number {
  return roundTo(ms * 3.6, 1);
}

/** The 8-point compass point of a bearing in degrees (any value, wrapped). */
export function compassPoint(degrees: number): CompassPoint {
  const wrapped = ((degrees % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(wrapped / 45) % 8];
}

/** "About" a distance: whole metres, to 10 m from 100 m up (as landingSummary). */
export function approxDistance(metres: number): number {
  return metres >= 100 ? Math.round(metres / 10) * 10 : Math.round(metres);
}

export interface Headline {
  inclination: number;
  heading: number;
  headingPoint: CompassPoint;
  distance: number;
  landingPoint: CompassPoint;
  /** False: no setting passes every hard check, this is only the closest. */
  passes: boolean;
}

/**
 * The recommended setting as the pieces of its sentence. `distance` is in the
 * length unit of `system` (m or ft), rounded like `approxDistance`.
 */
export function headline(best: LaunchCandidate, system: UnitSystem = "metric"): Headline {
  return {
    inclination: best.inclination,
    heading: best.heading,
    headingPoint: compassPoint(best.heading),
    distance: approxDistance(fromSi(best.landing_distance, "length", system)),
    landingPoint: compassPoint(best.landing_bearing),
    passes: best.checks_ok,
  };
}

/** The closest candidates first, at most `count`. */
export function topCandidates(candidates: readonly LaunchCandidate[], count = TOP_CANDIDATES): LaunchCandidate[] {
  return [...candidates].sort((a, b) => a.landing_distance - b.landing_distance).slice(0, count);
}

/** ok: passes; soft: a recommendation is missed (amber); hard: a limit is broken (red). */
export type CheckStatus = "ok" | "soft" | "hard";

export function checkStatus(check: LaunchCheck): CheckStatus {
  return check.ok ? "ok" : check.severity;
}

export function statusTone(status: CheckStatus): "ok" | "warn" | "bad" {
  return status === "ok" ? "ok" : status === "soft" ? "warn" : "bad";
}

/**
 * The requirement id to show: the guide's full id ("SURTSR-L1-REC-003")
 * for a short one ("REC-003"), the id as given when already full, and null
 * for common practice (the component says so).
 */
export function requirementLabel(source: string): string | null {
  if (source === "practice" || source === "") return null;
  return /^[A-Z]+-\d+$/.test(source) ? `SURTSR-L1-${source}` : source;
}

/**
 * What each check's value and limit measure (the API sends them in SI: m,
 * m/s, km/h for the wind, degrees, calibres); the unit system converts them.
 */
export const CHECK_KIND: Record<LaunchCheckId, MeasureKind> = {
  apogee_max: "length",
  apogee_recommended: "length",
  tilt_max: "angle",
  static_margin_min: "stability",
  descent_max: "speed",
  descent_recommended: "speed",
  landing_radius: "length",
  rail_exit_min: "speed",
  wind_max: "windSpeed",
};

/**
 * Decimals shown for a launch-day measure: calibres to the hundredth, speeds
 * and angles to the tenth, lengths and km/h whole; mph to the tenth so the
 * 32 km/h wind limit reads 19.9 mph, not a rounded-up 20.
 */
export function measureDecimals(kind: MeasureKind, system: UnitSystem): number {
  if (kind === "stability") return 2;
  if (kind === "speed" || kind === "angle") return 1;
  if (kind === "windSpeed") return system === "imperial" ? 1 : 0;
  return 0;
}
