/**
 * Rocket identity (S3): the view of one converted file the Workbench shows
 * before anything has run — what the `.ork` says about the rocket.
 *
 * Reads the export manifest, i.e. the `parameters.json` written by
 * packages/rocketserializer (`ork_extractor.py`). The keys used here and
 * their units, as the serializer emits them:
 *   - `id.rocket_name`                         (components/id.py)
 *   - `rocket.mass` kg at burnout, `rocket.radius` m (components/rocket.py)
 *   - `motors.grain_density` kg/m³, `grain_outer_radius`,
 *     `grain_initial_inner_radius`, `grain_initial_height` m,
 *     `grain_number`                            (components/motor.py)
 *   - `parachutes` = { "0": { name, … }, … }   (components/parachute.py)
 *   - `flight.rail_length` m, `inclination` ° from horizontal,
 *     `heading` °                               (components/flight.py)
 *   - `motors.identity` (optional, newer manifests): `designation`,
 *     `manufacturer`, `ork_motor_type`, `impulse_class`,
 *     `total_impulse_newton_seconds` N·s, `burn_time_seconds` s
 *   - `stored_results.max_altitude` m, `max_velocity` m/s,
 *     `flight_time` s, and (optional, newer manifests) `simulation_name`,
 *     `status`, `selection`                     (components/stored_results.py)
 *
 * The propellant mass is recovered from the grain geometry and density the
 * serializer derived from the thrust curve.
 *
 * Legacy rules: old manifests carry no `motors.identity` and no stored-results
 * provenance; they produce the same summary as before those keys existed
 * (identity fields null, `status: "unknown"`). The serializer still writes 0
 * for a stored result the .ork lacks, so a stored value ≤ 0 means "not
 * available" (null), never a real 0.
 *
 * Every missing or malformed value is `null`; the UI renders it as "—".
 */

export interface RailDefaults {
  length: number | null;
  inclination: number | null;
  heading: number | null;
}

export interface RocketSummary {
  name: string | null;
  dryMassKg: number | null;
  /** Dry mass plus propellant; null when the propellant mass is unknown. */
  liftoffMassKg: number | null;
  diameterMm: number | null;
  /** Null when the manifest says nothing about the motor. */
  motor: MotorSummary | null;
  parachutes: { count: number; names: string[] };
  railDefaults: RailDefaults;
  /** OpenRocket's own simulation saved in the file, under its own conditions. */
  storedResults: StoredResults | null;
}

export interface MotorSummary {
  /** e.g. "232H123-14A". */
  designation: string | null;
  manufacturer: string | null;
  /** OpenRocket's motor type, verbatim ("reload", "single", "hybrid"…). */
  orkMotorType: string | null;
  /** The impulse class letter parsed from the designation, e.g. "H". */
  impulseClass: string | null;
  /** Total impulse in newton-seconds (N·s); null when unknown or failed its class check. */
  totalImpulseNs: number | null;
  burnTimeS: number | null;
  propellantMassKg: number | null;
}

/** Status of the OpenRocket simulation the stored results come from; `unknown` for old manifests. */
export type StoredResultsStatus = "uptodate" | "outdated" | "loaded" | "unknown";

export interface StoredResults {
  apogeeM: number | null;
  maxVelocityMs: number | null;
  flightTimeS: number | null;
  simulationName: string | null;
  status: StoredResultsStatus;
  /** The serializer's reference-simulation rule, e.g. "uptodate_default". */
  selection: string | null;
}

type Dict = Record<string, unknown>;

function dict(value: unknown): Dict | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Dict) : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A stored result: the serializer writes 0 when the .ork has no value. */
function stored(value: unknown): number | null {
  const n = num(value);
  return n !== null && n > 0 ? n : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

const STATUSES: readonly StoredResultsStatus[] = ["uptodate", "outdated", "loaded"];

function status(value: unknown): StoredResultsStatus {
  return STATUSES.find((s) => s === value) ?? "unknown";
}

function motorSummary(motors: Dict | null): MotorSummary | null {
  const identity = dict(motors?.identity);
  const motor: MotorSummary = {
    designation: text(identity?.designation),
    manufacturer: text(identity?.manufacturer),
    orkMotorType: text(identity?.ork_motor_type),
    impulseClass: text(identity?.impulse_class),
    totalImpulseNs: stored(identity?.total_impulse_newton_seconds),
    burnTimeS: stored(identity?.burn_time_seconds),
    propellantMassKg: propellantMassKg(motors),
  };
  return Object.values(motor).some((v) => v !== null) ? motor : null;
}

function propellantMassKg(motor: Dict | null): number | null {
  if (!motor) return null;
  const density = num(motor.grain_density);
  const outer = num(motor.grain_outer_radius);
  const inner = num(motor.grain_initial_inner_radius);
  const height = num(motor.grain_initial_height);
  const grains = num(motor.grain_number) ?? 1;
  if (density === null || outer === null || inner === null || height === null) return null;
  const mass = density * Math.PI * (outer ** 2 - inner ** 2) * height * grains;
  return Number.isFinite(mass) && mass > 0 ? mass : null;
}

/** The launch rail as the file defines it (`manifest.flight`). */
export function railDefaultsFromManifest(manifest: unknown): RailDefaults {
  const flight = dict(dict(manifest)?.flight);
  return {
    length: num(flight?.rail_length),
    inclination: num(flight?.inclination),
    heading: num(flight?.heading),
  };
}

export function rocketSummaryFromManifest(manifest: unknown): RocketSummary {
  const m = dict(manifest);
  const rocket = dict(m?.rocket);
  const id = dict(m?.id);
  const rawName = id?.rocket_name ?? m?.name;
  const name = typeof rawName === "string" && rawName.trim() !== "" ? rawName : null;

  const dryMassKg = num(rocket?.mass);
  const radius = num(rocket?.radius);
  const motor = motorSummary(dict(m?.motors));
  const propellant = motor?.propellantMassKg ?? null;

  const chutes = Object.values(dict(m?.parachutes) ?? {})
    .map((chute) => dict(chute)?.name)
    .filter((n): n is string => typeof n === "string");

  const results = dict(m?.stored_results);
  const storedResults: StoredResults | null = results
    ? {
        apogeeM: stored(results.max_altitude),
        maxVelocityMs: stored(results.max_velocity),
        flightTimeS: stored(results.flight_time),
        simulationName: text(results.simulation_name),
        status: status(results.status),
        selection: text(results.selection),
      }
    : null;
  const hasStored =
    storedResults !== null &&
    (storedResults.apogeeM !== null || storedResults.maxVelocityMs !== null || storedResults.flightTimeS !== null);

  return {
    name,
    dryMassKg,
    liftoffMassKg: dryMassKg !== null && propellant !== null ? dryMassKg + propellant : null,
    diameterMm: radius !== null ? radius * 2 * 1000 : null,
    motor,
    parachutes: { count: chutes.length, names: chutes },
    railDefaults: railDefaultsFromManifest(manifest),
    storedResults: hasStored ? storedResults : null,
  };
}
