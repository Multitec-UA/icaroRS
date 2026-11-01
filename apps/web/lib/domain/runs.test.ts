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

describe("whatChanged — compared run against the baseline, on the canonical diff (S12a)", () => {
  it("returns no change for identical inputs, nor for key order, sub-metre noise or uncertainty", () => {
    expect(whatChanged(baseline, { ...baseline })).toEqual([]);
    const noisy: RunInputs = {
      ...baseline,
      scenario: {
        uncertainty: null,
        rail: { heading: 133, inclination: 84, length: 5.2 },
        atmosphere: { ...baseScenario.atmosphere },
        date: { ...baseScenario.date },
        site: { latitude: 38.345200001, longitude: -0.481, elevation: 12.01 },
        name: "",
      },
    };
    expect(whatChanged(baseline, noisy)).toEqual([]);
  });

  it("shows a chip for two runs that differ only by the launch date", () => {
    const run: RunInputs = { ...baseline, scenario: { ...baseScenario, date: { ...baseScenario.date, hour: 15 } } };
    expect(whatChanged(baseline, run)).toEqual([
      { group: "date", key: "launchDate", from: "2026-11-07T11:00:00Z", to: "2026-11-07T15:00:00Z" },
    ]);
  });

  it("shows a chip for two runs that differ only by the file, even with the same file name", () => {
    expect(whatChanged(baseline, { ...baseline, export_id: "exp-9" })).toEqual([
      { group: "file", key: "file", from: "icarus2.ork", to: "icarus2.ork" },
    ]);
    expect(whatChanged(baseline, { ...baseline, export_id: "exp-2", ork_filename: "icarus2_v3.ork" })).toEqual([
      { group: "file", key: "file", from: "icarus2.ork", to: "icarus2_v3.ork" },
    ]);
  });

  it("names the site's elevation and the weather's fallback, which the old diff ignored", () => {
    const run: RunInputs = {
      ...baseline,
      scenario: {
        ...baseScenario,
        site: { ...baseScenario.site, elevation: 40 },
        atmosphere: { ...baseScenario.atmosphere, fallback: "other" },
      },
    };
    expect(whatChanged(baseline, run)).toEqual([
      { group: "site", key: "elevation", from: "12", to: "40" },
      { group: "weather", key: "fallback", from: "standard_atmosphere", to: "other" },
    ]);
  });

  it("details every changed field in the order file, site, date, weather, rail", () => {
    const run: RunInputs = {
      scenario: {
        ...baseScenario,
        site: { latitude: 39.5, longitude: -0.4, elevation: 12 },
        date: { year: 2026, month: 11, day: 7, hour: 15 },
        atmosphere: { ...baseScenario.atmosphere, model: "wyoming_sounding", station: "08221" },
        rail: { length: 6, inclination: 88, heading: 90 },
        uncertainty: { mass: { std: 0.05, kind: "relative" } },
      },
      ork_filename: "icarus2_v3.ork",
      export_id: "exp-2",
    };
    expect(whatChanged(baseline, run)).toEqual([
      { group: "file", key: "file", from: "icarus2.ork", to: "icarus2_v3.ork" },
      { group: "site", key: "site", from: "38.3452, -0.481", to: "39.5, -0.4" },
      { group: "date", key: "launchDate", from: "2026-11-07T11:00:00Z", to: "2026-11-07T15:00:00Z" },
      { group: "weather", key: "atmosphere", from: "forecast", to: "wyoming_sounding" },
      { group: "weather", key: "station", from: null, to: "08221" },
      { group: "rail", key: "railLength", from: "5.2", to: "6" },
      { group: "rail", key: "railInclination", from: "84", to: "88" },
      { group: "rail", key: "railHeading", from: "133", to: "90" },
    ]);
  });

  it("reports unset values as null, and a stored rail: null as no rail", () => {
    const run: RunInputs = { ...baseline, scenario: { ...baseScenario, rail: null, date: null } };
    expect(whatChanged(baseline, run)).toEqual([
      { group: "date", key: "launchDate", from: "2026-11-07T11:00:00Z", to: null },
      { group: "rail", key: "railLength", from: "5.2", to: null },
      { group: "rail", key: "railInclination", from: "84", to: null },
      { group: "rail", key: "railHeading", from: "133", to: null },
    ]);
  });

  it("falls back to one chip for the group when it changed in a field without its own chip", () => {
    const run: RunInputs = { ...baseline, scenario: { ...baseScenario, site: { ...baseScenario.site, name: "Pad B" } } };
    expect(whatChanged(baseline, run)).toEqual([{ group: "site", key: "other", from: null, to: null }]);
  });
});

describe("scenarioFacts — what a scenario says, for labels", () => {
  it("extracts the site, launch date, model and rail", () => {
    expect(scenarioFacts(baseScenario)).toEqual({
      name: null,
      site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
      launchDateIso: "2026-11-07T11:00:00Z",
      model: "forecast",
      rail: { length: 5.2, inclination: 84, heading: 133 },
    });
  });

  it("tolerates a scenario with nothing filled in", () => {
    expect(scenarioFacts({})).toEqual({
      name: null,
      site: null,
      launchDateIso: null,
      model: null,
      rail: null,
    });
    expect(scenarioFacts({ name: "Alicante pad" }).name).toBe("Alicante pad");
  });
});
