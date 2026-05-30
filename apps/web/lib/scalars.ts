/**
 * Presentation map for simulation result scalars.
 *
 * Mirrors `_SCALAR_LABEL_MAP` in apps/api/icaro_api/serialize.py — plain-language
 * labels + units so a non-expert reads "Highest point (apogee): 822 m" instead
 * of a raw key. `primary` flags the headline numbers shown as big cards; the
 * rest render in a details table.
 */

export interface ScalarSpec {
  key: string;
  label: string;
  unit: string;
  primary?: boolean;
  /** Glossary term key (see lib/glossary.ts) for an info tooltip. */
  term?: string;
}

export const SCALAR_SPECS: ScalarSpec[] = [
  { key: "apogee_m", label: "Highest point above ground (apogee)", unit: "m", primary: true, term: "apogee" },
  { key: "max_velocity_ms", label: "Maximum speed", unit: "m/s", primary: true },
  { key: "max_mach", label: "Maximum Mach number", unit: "", primary: true, term: "mach" },
  { key: "flight_time_s", label: "Total flight time", unit: "s", primary: true },
  { key: "apogee_time_s", label: "Time to apogee", unit: "s" },
  { key: "max_acceleration_ms2", label: "Maximum acceleration", unit: "m/s²" },
  { key: "max_acceleration_time_s", label: "Time of max acceleration", unit: "s" },
  { key: "max_velocity_time_s", label: "Time of maximum speed", unit: "s" },
  { key: "rail_departure_velocity_ms", label: "Rail departure velocity", unit: "m/s", term: "rail_departure" },
  { key: "rail_departure_time_s", label: "Rail departure time", unit: "s" },
  { key: "rail_departure_stability_margin", label: "Rail departure stability margin", unit: "cal", term: "stability_margin" },
  { key: "impact_velocity_ms", label: "Impact velocity", unit: "m/s" },
  { key: "apogee_x_m", label: "Apogee — East displacement", unit: "m" },
  { key: "apogee_y_m", label: "Apogee — North displacement", unit: "m" },
  { key: "impact_x_m", label: "Impact — East displacement", unit: "m" },
  { key: "impact_y_m", label: "Impact — North displacement", unit: "m" },
];

/** Human title for a plot filename stem (derived from the URL). */
export function plotTitle(stem: string): string {
  const map: Record<string, string> = {
    trajectory_3d: "3D trajectory",
    linear_kinematics: "Linear kinematics",
    flight_path_angle: "Flight path angle",
    energy: "Energy",
    aerodynamic_forces: "Aerodynamic forces",
    stability_control: "Stability & control",
    angular_kinematics: "Angular kinematics",
    attitude: "Attitude",
    fluid_mechanics: "Fluid mechanics",
    pressure_altitude: "Pressure vs altitude",
    rail_bending_moments: "Rail button bending moments",
    rail_forces: "Rail button forces",
  };
  return map[stem] ?? stem.replace(/_/g, " ");
}

/** Format a scalar value for display (rounded, locale-grouped). */
export function formatScalar(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const num = value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
  return unit ? `${num} ${unit}` : num;
}
