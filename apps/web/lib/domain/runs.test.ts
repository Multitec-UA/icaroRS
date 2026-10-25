import { describe, expect, it } from "vitest";
import {
  formatDelta,
  runDeltas,
  runMetrics,
  scenarioFacts,
  whatChanged,
  type RunInputs,
} from "./runs";

const baseScenario = {
  name: "",
  site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
  date: { year: 2026, month: 11, day: 7, hour: 11 },
  atmosphere: { model: "forecast", file: null, station: null, fallback: "standard_atmosphere" },
  rail: { length: 5.2, inclination: 84, heading: 133 },
  uncertainty: { mass: { std: 0.02, kind: "relative" } },
};

const baseline: RunInputs = { scenario: baseScenario, ork_filename: "icarus2.ork", export_id: "exp-1" };

describe("runMetrics — the four compared numbers of a run", () => {
  it("reads the result scalars and derives the landing distance", () => {
    expect(
      runMetrics({ apogee_m: 3142.2, max_velocity_ms: 287.4, flight_time_s: 142, impact_x_m: 300, impact_y_m: 400 }),
    ).toEqual({ apogee: 3142.2, maxSpeed: 287.4, flightTime: 142, landing: 500 });
  });

  it("falls back to the history row's apogee alias and leaves missing values null", () => {
    expect(runMetrics({ apogee: 1000 })).toEqual({ apogee: 1000, maxSpeed: null, flightTime: null, landing: null });
    expect(runMetrics({ apogee_m: "3142", impact_x_m: 10 })).toEqual({
      apogee: null,
      maxSpeed: null,
      flightTime: null,
      landing: null,
    });
    expect(runMetrics(null)).toEqual({ apogee: null, maxSpeed: null, flightTime: null, landing: null });
  });
});

describe("runDeltas — run minus baseline, per metric", () => {
  it("keeps the sign and reports null when either side is missing", () => {
    const base = runMetrics({ apogee_m: 3142, max_velocity_ms: 287, flight_time_s: 142 });
    const run = runMetrics({ apogee_m: 3088, max_velocity_ms: 290, impact_x_m: 3, impact_y_m: 4 });
    expect(runDeltas(base, run)).toEqual({ apogee: -54, maxSpeed: 3, flightTime: null, landing: null });
  });
});

describe("formatDelta — signed, locale-formatted", () => {
  it("prefixes positive deltas with a plus sign and formats with the locale", () => {
    expect(formatDelta(74, "en", "m")).toBe("+74 m");
    expect(formatDelta(-1234.5, "en", "m")).toBe("-1,235 m");
    expect(formatDelta(0.45, "en", "km")).toBe("+0.45 km");
    expect(formatDelta(0, "en", "m")).toBe("0 m");
  });
});

describe("whatChanged — compared run against the baseline", () => {
  it("returns no change for identical inputs", () => {
    expect(whatChanged(baseline, { ...baseline })).toEqual([]);
  });

  it("names each changed scenario field with its before and after values", () => {
    const run: RunInputs = {
      ...baseline,
      scenario: {
        ...baseScenario,
        site: { latitude: 39.5, longitude: -0.4, elevation: 12 },
        date: { year: 2026, month: 11, day: 7, hour: 15 },
        atmosphere: { ...baseScenario.atmosphere, model: "standard_atmosphere" },
        rail: { length: 6, inclination: 88, heading: 90 },
        uncertainty: { mass: { std: 0.05, kind: "relative" } },
      },
    };
    expect(whatChanged(baseline, run)).toEqual([
      { key: "site", from: "38.3452, -0.481", to: "39.5, -0.4" },
      { key: "launchDate", from: "2026-11-07T11:00:00Z", to: "2026-11-07T15:00:00Z" },
      { key: "atmosphere", from: "forecast", to: "standard_atmosphere" },
      { key: "railLength", from: "5.2", to: "6" },
      { key: "railInclination", from: "84", to: "88" },
      { key: "railHeading", from: "133", to: "90" },
      { key: "uncertainty", from: null, to: null },
    ]);
  });

  it("reports a different file by its name, and unset values as null", () => {
    const run: RunInputs = {
      scenario: { ...baseScenario, rail: null, date: null },
      ork_filename: "icarus2_v3.ork",
      export_id: "exp-2",
    };
    expect(whatChanged(baseline, run)).toEqual([
      { key: "launchDate", from: "2026-11-07T11:00:00Z", to: null },
      { key: "railLength", from: "5.2", to: null },
      { key: "railInclination", from: "84", to: null },
      { key: "railHeading", from: "133", to: null },
      { key: "file", from: "icarus2.ork", to: "icarus2_v3.ork" },
    ]);
  });

  it("treats a different export with the same file name as a different file", () => {
    expect(whatChanged(baseline, { ...baseline, export_id: "exp-9" })).toEqual([
      { key: "file", from: "icarus2.ork", to: "icarus2.ork" },
    ]);
  });
});

describe("scenarioFacts — what a scenario says, for labels", () => {
  it("extracts the site, launch date, model, rail and uncertainty presence", () => {
    expect(scenarioFacts(baseScenario)).toEqual({
      name: null,
      site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
      launchDateIso: "2026-11-07T11:00:00Z",
      model: "forecast",
      rail: { length: 5.2, inclination: 84, heading: 133 },
      hasUncertainty: true,
    });
  });

  it("tolerates a scenario with nothing filled in", () => {
    expect(scenarioFacts({})).toEqual({
      name: null,
      site: null,
      launchDateIso: null,
      model: null,
      rail: null,
      hasUncertainty: false,
    });
    expect(scenarioFacts({ name: "Alicante pad" }).name).toBe("Alicante pad");
  });
});
