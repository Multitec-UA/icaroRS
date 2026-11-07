/**
 * Presentation map for simulation result scalars.
 *
 * Mirrors `_SCALAR_LABEL_MAP` in apps/api/icaro_api/serialize.py.
 * Labels are now served from the i18n catalog:
 *   t("scalars." + spec.key)  → localized label
 *   t("plots." + stem)        → localized plot title
 *
 * `primary` flags the headline numbers shown as big cards; the rest render
 * in a details table. `term` links to a glossary tooltip.
 */

import type { Locale } from "@/lib/i18n";
import { formatMeasure, type MeasureKind, type UnitSystem } from "@/lib/units";

export interface ScalarSpec {
  key: string;
  /** The metric unit (what the API returns); `unitLabel(kind, "metric")` equals it. */
  unit: string;
  /** What the scalar measures, so it converts with the unit system. */
  kind: MeasureKind;
  primary?: boolean;
  /** Glossary term key (see lib/glossary.ts) for an info tooltip. */
  term?: string;
}

export const SCALAR_SPECS: ScalarSpec[] = [
  { key: "apogee_m", unit: "m", kind: "length", primary: true, term: "apogee" },
  { key: "max_velocity_ms", unit: "m/s", kind: "speed", primary: true },
  { key: "max_mach", unit: "", kind: "none", primary: true, term: "mach" },
  { key: "flight_time_s", unit: "s", kind: "time", primary: true },
  { key: "apogee_time_s", unit: "s", kind: "time" },
  { key: "max_acceleration_ms2", unit: "m/s²", kind: "acceleration" },
  { key: "max_acceleration_time_s", unit: "s", kind: "time" },
  { key: "max_velocity_time_s", unit: "s", kind: "time" },
  { key: "rail_departure_velocity_ms", unit: "m/s", kind: "speed", term: "rail_departure" },
  { key: "rail_departure_time_s", unit: "s", kind: "time" },
  { key: "rail_departure_stability_margin", unit: "cal", kind: "stability", term: "stability_margin" },
  // With body lift at the rail-exit angle of attack (OpenRocket's number); runs stored before it lack both.
  { key: "rail_departure_stability_margin_wind", unit: "cal", kind: "stability", term: "stability_margin_wind" },
  { key: "rail_departure_angle_of_attack_deg", unit: "°", kind: "angle" },
  { key: "impact_velocity_ms", unit: "m/s", kind: "speed" },
  { key: "apogee_x_m", unit: "m", kind: "length" },
  { key: "apogee_y_m", unit: "m", kind: "length" },
  { key: "impact_x_m", unit: "m", kind: "length" },
  { key: "impact_y_m", unit: "m", kind: "length" },
];

/** Format a scalar value for display (rounded, locale-grouped). */
export function formatScalar(
  value: number | null,
  unit: string,
  locale: Locale = "en",
): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const num = value.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return unit ? `${num} ${unit}` : num;
}

/**
 * A scalar in the unit system in effect: the SI value converted with the
 * spec's kind and labelled for `system`. Metric is exactly `formatScalar`.
 */
export function formatScalarIn(
  value: number | null,
  spec: Pick<ScalarSpec, "kind">,
  system: UnitSystem,
  locale: Locale = "en",
): string {
  return formatMeasure(value, spec.kind, system, locale);
}
