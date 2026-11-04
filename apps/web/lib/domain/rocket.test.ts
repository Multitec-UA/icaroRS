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

const NO_IDENTITY = {
  designation: null,
  manufacturer: null,
  orkMotorType: null,
  impulseClass: null,
  totalImpulseNs: null,
  burnTimeS: null,
};
const NO_PROVENANCE = { simulationName: null, status: "unknown", selection: null };

describe("rocketSummaryFromManifest", () => {
  it("derives every field from a full serializer manifest", () => {
    const summary = rocketSummaryFromManifest(FULL_MANIFEST);
    // propellant = density × π(Ro² − Ri²) × height × grains = 1800 × π × 0.0003 × 0.5
    const propellant = 1800 * Math.PI * (0.02 ** 2 - 0.01 ** 2) * 0.5;
    expect(summary.name).toBe("Icarus Mk II");
    expect(summary.dryMassKg).toBe(7.84);
    expect(summary.liftoffMassKg).toBeCloseTo(7.84 + propellant, 6);
    expect(summary.diameterMm).toBeCloseTo(127, 6);
    // A legacy manifest (no motors.identity, no provenance): identity fields are null.
    expect(summary.motor).toEqual({ ...NO_IDENTITY, propellantMassKg: expect.closeTo(propellant, 6) });
    expect(summary.parachutes).toEqual({ count: 2, names: ["Drogue", "Main"] });
    expect(summary.railDefaults).toEqual({ length: 5.2, inclination: 85, heading: 90 });
    expect(summary.storedResults).toEqual({
      apogeeM: 1832.4,
      maxVelocityMs: 291.7,
      flightTimeS: 128.3,
      ...NO_PROVENANCE,
    });
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

describe("rocketSummaryFromManifest — motor identity and provenance (S4)", () => {
  const IDENTITY = {
    designation: "232H123-14A",
    manufacturer: "Cesaroni Technology",
    ork_motor_type: "reload",
    config_id: "cfg-1",
    motor_count: 1,
    impulse_class: "H",
    total_impulse_newton_seconds: 232,
    impulse_check: "ok",
    burn_time_seconds: 1.94,
  };
  const ENRICHED = {
    ...FULL_MANIFEST,
    id: { ...FULL_MANIFEST.id, ork_format_version: "1.10", creator: "OpenRocket 24.12", serializer_version: "1.0.0" },
    motors: { ...FULL_MANIFEST.motors, identity: IDENTITY },
    stored_results: {
      ...FULL_MANIFEST.stored_results,
      simulation_name: "Simulation 1",
      status: "uptodate",
      config_id: "cfg-1",
      selection: "uptodate_default",
    },
  };

  it("reads motors.identity into the motor", () => {
    const propellant = 1800 * Math.PI * (0.02 ** 2 - 0.01 ** 2) * 0.5;
    expect(rocketSummaryFromManifest(ENRICHED).motor).toEqual({
      designation: "232H123-14A",
      manufacturer: "Cesaroni Technology",
      orkMotorType: "reload",
      impulseClass: "H",
      totalImpulseNs: 232,
      burnTimeS: 1.94,
      propellantMassKg: expect.closeTo(propellant, 6),
    });
  });

  it("keeps the class but no impulse when the serializer dropped it (class_mismatch)", () => {
    const motor = rocketSummaryFromManifest({
      ...ENRICHED,
      motors: { identity: { ...IDENTITY, total_impulse_newton_seconds: null, impulse_check: "class_mismatch" } },
    }).motor;
    expect(motor).toEqual({
      designation: "232H123-14A",
      manufacturer: "Cesaroni Technology",
      orkMotorType: "reload",
      impulseClass: "H",
      totalImpulseNs: null,
      burnTimeS: 1.94,
      // No grain geometry: the propellant is unknown, the motor is still named.
      propellantMassKg: null,
    });
  });

  it("reads the stored-results provenance", () => {
    expect(rocketSummaryFromManifest(ENRICHED).storedResults).toEqual({
      apogeeM: 1832.4,
      maxVelocityMs: 291.7,
      flightTimeS: 128.3,
      simulationName: "Simulation 1",
      status: "uptodate",
      selection: "uptodate_default",
    });
  });

  it.each(["outdated", "loaded"] as const)("passes the %s status through", (status) => {
    const summary = rocketSummaryFromManifest({ ...ENRICHED, stored_results: { ...ENRICHED.stored_results, status } });
    expect(summary.storedResults?.status).toBe(status);
  });

  it("maps an absent, null or unrecognised status to unknown", () => {
    for (const status of [undefined, null, "weird", 3]) {
      const summary = rocketSummaryFromManifest({
        stored_results: { max_altitude: 1000, simulation_name: "Sim", status },
      });
      expect(summary.storedResults?.status).toBe("unknown");
    }
  });

  it("produces exactly today's summary for a legacy manifest (no identity, no provenance)", () => {
    const legacy = rocketSummaryFromManifest(FULL_MANIFEST);
    const enriched = rocketSummaryFromManifest(ENRICHED);
    expect(legacy.motor).toMatchObject(NO_IDENTITY);
    expect(legacy.storedResults).toMatchObject(NO_PROVENANCE);
    // Everything else is identical with or without the new keys.
    expect({ ...legacy, motor: null, storedResults: null }).toEqual({ ...enriched, motor: null, storedResults: null });
  });
});

describe("railDefaultsFromManifest", () => {
  it("reads manifest.flight", () => {
    expect(railDefaultsFromManifest(FULL_MANIFEST)).toEqual({ length: 5.2, inclination: 85, heading: 90 });
  });
});
