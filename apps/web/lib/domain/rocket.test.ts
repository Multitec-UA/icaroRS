import { describe, expect, it } from "vitest";
import { railDefaultsFromManifest, rocketSummaryFromManifest } from "./rocket";

// Shape of a real parameters.json written by rocketserializer (ork_extractor):
// `id.rocket_name`, `rocket.mass` (kg, at burnout) + `rocket.radius` (m),
// `motors` as one SolidMotor dict, `parachutes` keyed "0", "1"…, `flight`
// already converted to RocketPy's inclination, `stored_results` in SI.
const FULL_MANIFEST = {
  id: { rocket_name: "Icarus Mk II", comment: null, designer: null },
  rocket: { mass: 7.84, radius: 0.0635, inertia: [1, 1, 0.1] },
  motors: {
    grain_density: 1800,
    grain_initial_inner_radius: 0.01,
    grain_outer_radius: 0.02,
    grain_initial_height: 0.5,
    grain_number: 1,
    dry_mass: 0,
  },
  parachutes: {
    "0": { name: "Drogue", cd: 1.6, deploy_event: "apogee" },
    "1": { name: "Main", cd: 2.2, deploy_event: "altitude" },
  },
  flight: { rail_length: 5.2, inclination: 85, heading: 90 },
  stored_results: { max_altitude: 1832.4, max_velocity: 291.7, flight_time: 128.3, max_mach: 0.86 },
};

describe("rocketSummaryFromManifest", () => {
  it("derives every field from a full serializer manifest", () => {
    const summary = rocketSummaryFromManifest(FULL_MANIFEST);
    // propellant = density × π(Ro² − Ri²) × height × grains = 1800 × π × 0.0003 × 0.5
    const propellant = 1800 * Math.PI * (0.02 ** 2 - 0.01 ** 2) * 0.5;
    expect(summary.name).toBe("Icarus Mk II");
    expect(summary.dryMassKg).toBe(7.84);
    expect(summary.liftoffMassKg).toBeCloseTo(7.84 + propellant, 6);
    expect(summary.diameterMm).toBeCloseTo(127, 6);
    expect(summary.motor).toEqual({ propellantMassKg: expect.closeTo(propellant, 6) });
    expect(summary.parachutes).toEqual({ count: 2, names: ["Drogue", "Main"] });
    expect(summary.railDefaults).toEqual({ length: 5.2, inclination: 85, heading: 90 });
    expect(summary.storedResults).toEqual({ apogeeM: 1832.4, maxVelocityMs: 291.7, flightTimeS: 128.3 });
  });

  it("returns nulls, never undefined or NaN, for an empty manifest", () => {
    const summary = rocketSummaryFromManifest({});
    expect(summary).toEqual({
      name: null,
      dryMassKg: null,
      liftoffMassKg: null,
      diameterMm: null,
      motor: null,
      parachutes: { count: 0, names: [] },
      railDefaults: { length: null, inclination: null, heading: null },
      storedResults: null,
    });
  });

  it("tolerates a manifest with no motor and no stored results", () => {
    const summary = rocketSummaryFromManifest({
      id: { rocket_name: "Dédalo" },
      rocket: { mass: 5.31, radius: 0.0508 },
      flight: { rail_length: 2, inclination: 87, heading: 0 },
    });
    expect(summary.name).toBe("Dédalo");
    expect(summary.dryMassKg).toBe(5.31);
    // Without propellant data the liftoff mass is unknown, not equal to dry.
    expect(summary.liftoffMassKg).toBeNull();
    expect(summary.motor).toBeNull();
    expect(summary.storedResults).toBeNull();
    expect(summary.railDefaults).toEqual({ length: 2, inclination: 87, heading: 0 });
  });

  it("treats the serializer's 0 placeholders for missing stored results as absent", () => {
    // search_stored_results writes 0 when the .ork has no <flightdata> value.
    const summary = rocketSummaryFromManifest({
      stored_results: { max_altitude: 0, max_velocity: 0, flight_time: 0 },
    });
    expect(summary.storedResults).toBeNull();
  });

  it("ignores non-object and non-numeric garbage", () => {
    expect(rocketSummaryFromManifest(null).name).toBeNull();
    expect(rocketSummaryFromManifest("x").dryMassKg).toBeNull();
    expect(rocketSummaryFromManifest({ rocket: { mass: "heavy", radius: Number.NaN } }).diameterMm).toBeNull();
  });
});

describe("railDefaultsFromManifest", () => {
  it("reads manifest.flight", () => {
    expect(railDefaultsFromManifest(FULL_MANIFEST)).toEqual({ length: 5.2, inclination: 85, heading: 90 });
  });
});
