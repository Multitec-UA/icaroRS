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

export interface ScalarSpec {
  key: string;
  unit: string;
  primary?: boolean;
  /** Glossary term key (see lib/glossary.ts) for an info tooltip. */
  term?: string;
}

export const SCALAR_SPECS: ScalarSpec[] = [
  { key: "apogee_m", unit: "m", primary: true, term: "apogee" },
  { key: "max_velocity_ms", unit: "m/s", primary: true },
  { key: "max_mach", unit: "", primary: true, term: "mach" },
  { key: "flight_time_s", unit: "s", primary: true },
  { key: "apogee_time_s", unit: "s" },
  { key: "max_acceleration_ms2", unit: "m/s²" },
  { key: "max_acceleration_time_s", unit: "s" },
  { key: "max_velocity_time_s", unit: "s" },
  { key: "rail_departure_velocity_ms", unit: "m/s", term: "rail_departure" },
  { key: "rail_departure_time_s", unit: "s" },
  { key: "rail_departure_stability_margin", unit: "cal", term: "stability_margin" },
  { key: "impact_velocity_ms", unit: "m/s" },
  { key: "apogee_x_m", unit: "m" },
  { key: "apogee_y_m", unit: "m" },
  { key: "impact_x_m", unit: "m" },
  { key: "impact_y_m", unit: "m" },
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
