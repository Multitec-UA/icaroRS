/**
 * Unit system — plain data and pure helpers, no React.
 *
 * The API and the domain are metric (SI) and stay that way; this module only
 * changes what the user SEES and TYPES. `metric` is the default and renders
 * exactly what the app rendered before the switch existed. `imperial` follows
 * the units the SURT x SpainRocketry L1 guide uses: feet for altitude and
 * distance, ft/s for flight speeds (the guide states landing limits in ft/s),
 * mph for the wind on the pad, pounds and inches for the rocket.
 *
 * Every visible measurement should go through `formatMeasure` (or the
 * `useUnits().format` wrapper) with its *kind*, so one switch converts all of
 * them and nothing stays hard-coded in metric.
 */

import type { Locale } from "@/lib/i18n";

export type UnitSystem = "metric" | "imperial";

export const UNITS_COOKIE = "icaro-units";
export const UNITS_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** What a number measures; decides both the factor and the label. */
export type MeasureKind =
  | "length" // m ↔ ft (altitude, apogee, rail length, landing distance, elevation)
  | "distance" // km ↔ mi (long distances)
  | "speed" // m/s ↔ ft/s (flight, rail exit, descent, impact)
  | "windSpeed" // km/h ↔ mph (wind on the pad, L1 wind limit)
  | "mass" // kg ↔ lb
  | "diameter" // mm ↔ in
  | "acceleration" // m/s² ↔ ft/s²
  | "impulse" // N·s (unchanged)
  | "angle" // ° (unchanged)
  | "time" // s (unchanged)
  | "stability" // cal (unchanged)
  | "none"; // Mach, %, counts

const FT_PER_M = 1 / 0.3048; // exact: 1 ft is defined as 0.3048 m
const MI_PER_KM = 0.621371;
const LB_PER_KG = 2.20462;
const IN_PER_MM = 1 / 25.4;
const MPH_PER_KMH = 0.621371;

interface KindSpec {
  metric: string;
  imperial: string;
  /** Multiply an SI (metric display) value by this to get the imperial one. */
  factor: number;
}

const KINDS: Record<MeasureKind, KindSpec> = {
  length: { metric: "m", imperial: "ft", factor: FT_PER_M },
  distance: { metric: "km", imperial: "mi", factor: MI_PER_KM },
  speed: { metric: "m/s", imperial: "ft/s", factor: FT_PER_M },
  windSpeed: { metric: "km/h", imperial: "mph", factor: MPH_PER_KMH },
  mass: { metric: "kg", imperial: "lb", factor: LB_PER_KG },
  diameter: { metric: "mm", imperial: "in", factor: IN_PER_MM },
  acceleration: { metric: "m/s²", imperial: "ft/s²", factor: FT_PER_M },
  impulse: { metric: "N·s", imperial: "N·s", factor: 1 },
  angle: { metric: "°", imperial: "°", factor: 1 },
  time: { metric: "s", imperial: "s", factor: 1 },
  stability: { metric: "cal", imperial: "cal", factor: 1 },
  none: { metric: "", imperial: "", factor: 1 },
};

export function resolveUnitSystem(cookieValue: string | undefined | null): UnitSystem {
  return cookieValue === "imperial" ? "imperial" : "metric";
}

export function unitLabel(kind: MeasureKind, system: UnitSystem): string {
  return KINDS[kind][system];
}

/** SI (metric display unit) → the display unit of `system`. */
export function fromSi(value: number, kind: MeasureKind, system: UnitSystem): number {
  return system === "imperial" ? value * KINDS[kind].factor : value;
}

/** The display unit of `system` → SI (metric display unit). */
export function toSi(value: number, kind: MeasureKind, system: UnitSystem): number {
  return system === "imperial" ? value / KINDS[kind].factor : value;
}

export function convert(value: number, kind: MeasureKind, from: UnitSystem, to: UnitSystem): number {
  return fromSi(toSi(value, kind, from), kind, to);
}

/**
 * Round and group like `formatScalar` always did (0 decimals from 100, 1 from
 * 10, 2 below), so the metric output is byte-identical to the pre-switch app.
 */
export function formatNumber(value: number, locale: Locale): string {
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return value.toLocaleString(locale, { minimumFractionDigits: 0, maximumFractionDigits: digits });
}

/** `"816 m"` / `"2,678 ft"`; `"—"` for a missing value. */
export function formatMeasure(
  value: number | null | undefined,
  kind: MeasureKind,
  system: UnitSystem,
  locale: Locale = "en",
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const num = formatNumber(fromSi(value, kind, system), locale);
  const label = unitLabel(kind, system);
  return label ? `${num} ${label}` : num;
}
