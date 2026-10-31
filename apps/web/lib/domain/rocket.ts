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
 *   - `stored_results.max_altitude` m, `max_velocity` m/s,
 *     `flight_time` s                           (components/stored_results.py)
 *
 * The serializer emits no motor designation and no total impulse, so the
 * motor is described by its propellant mass (recovered from the grain
 * geometry and density the serializer derived from it).
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
  motor: { propellantMassKg: number } | null;
  parachutes: { count: number; names: string[] };
  railDefaults: RailDefaults;
  /** OpenRocket's own simulation saved in the file, under its own conditions. */
  storedResults: { apogeeM: number | null; maxVelocityMs: number | null; flightTimeS: number | null } | null;
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
  const propellant = propellantMassKg(dict(m?.motors));

  const chutes = Object.values(dict(m?.parachutes) ?? {})
    .map((chute) => dict(chute)?.name)
    .filter((n): n is string => typeof n === "string");

  const results = dict(m?.stored_results);
  const storedResults = results
    ? {
        apogeeM: stored(results.max_altitude),
        maxVelocityMs: stored(results.max_velocity),
        flightTimeS: stored(results.flight_time),
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
    motor: propellant !== null ? { propellantMassKg: propellant } : null,
    parachutes: { count: chutes.length, names: chutes },
    railDefaults: railDefaultsFromManifest(manifest),
    storedResults: hasStored ? storedResults : null,
  };
}
