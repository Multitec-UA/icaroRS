import { describe, expect, it } from "vitest";
import type { Atmosphere } from "@/lib/api";
import {
  STEP_ORDER,
  buildScenarioBody,
  canAdvance,
  needsDate,
  toLaunchDate,
} from "./scenario";

const STANDARD_ATMOSPHERE: Atmosphere = {
  model: "standard_atmosphere",
  file: null,
  station: null,
  fallback: "standard_atmosphere",
};

const FORECAST_ATMOSPHERE: Atmosphere = {
  model: "forecast",
  file: null,
  station: null,
  fallback: "standard_atmosphere",
};

describe("STEP_ORDER", () => {
  it("lists every step exactly once, in wizard order", () => {
    expect(STEP_ORDER).toEqual(["rocket", "basics", "advanced", "review", "results"]);
  });
});

describe("needsDate", () => {
  it("is true for forecast and wyoming_sounding", () => {
    expect(needsDate("forecast")).toBe(true);
    expect(needsDate("wyoming_sounding")).toBe(true);
  });

  it("is false for standard_atmosphere and reanalysis", () => {
    expect(needsDate("standard_atmosphere")).toBe(false);
    expect(needsDate("reanalysis")).toBe(false);
  });
});

describe("toLaunchDate", () => {
  it("returns null for a null input", () => {
    expect(toLaunchDate(null)).toBeNull();
  });

  it("parses a datetime-local string literally, without a timezone shift", () => {
    expect(toLaunchDate("2026-06-01T09:54")).toEqual({
      year: 2026,
      month: 6,
      day: 1,
      hour: 9,
    });
  });

  it("returns null for a malformed string", () => {
    expect(toLaunchDate("not-a-date")).toBeNull();
  });
});

describe("buildScenarioBody", () => {
  it("assembles the validate/simulate payload from a draft", () => {
    expect(
      buildScenarioBody({
        name: "acme-1",
        site: { latitude: 1, longitude: 2, elevation: 3 },
        launchDatetime: "2026-06-01T09:54",
        atmosphere: STANDARD_ATMOSPHERE,
        rail: null,
        uncertainty: null,
      }),
    ).toEqual({
      name: "acme-1",
      site: { latitude: 1, longitude: 2, elevation: 3 },
      date: { year: 2026, month: 6, day: 1, hour: 9 },
      atmosphere: STANDARD_ATMOSPHERE,
      rail: null,
      uncertainty: null,
    });
  });

  it("passes through a null site/rail/uncertainty and a null launch date", () => {
    expect(
      buildScenarioBody({
        name: "acme-1",
        site: null,
        launchDatetime: null,
        atmosphere: STANDARD_ATMOSPHERE,
        rail: null,
        uncertainty: null,
      }),
    ).toEqual({
      name: "acme-1",
      site: null,
      date: null,
      atmosphere: STANDARD_ATMOSPHERE,
      rail: null,
      uncertainty: null,
    });
  });
});

describe("canAdvance", () => {
  it("rocket: requires an exportId", () => {
    const progress = {
      exportId: null,
      site: null,
      atmosphere: STANDARD_ATMOSPHERE,
      launchDatetime: null,
      result: null,
    };
    expect(canAdvance("rocket", progress)).toBe(false);
    expect(canAdvance("rocket", { ...progress, exportId: "export-1" })).toBe(true);
  });

  it("basics: requires a finite site, and a launch date only when the model needs one", () => {
    const base = {
      exportId: "export-1",
      site: { latitude: 10, longitude: 20, elevation: null },
      atmosphere: STANDARD_ATMOSPHERE,
      launchDatetime: null,
      result: null,
    };
    expect(canAdvance("basics", base)).toBe(true);
    expect(canAdvance("basics", { ...base, site: null })).toBe(false);
    expect(
      canAdvance("basics", {
        ...base,
        site: { latitude: Number.NaN, longitude: 20, elevation: null },
      }),
    ).toBe(false);

    // forecast needs a date
    expect(canAdvance("basics", { ...base, atmosphere: FORECAST_ATMOSPHERE })).toBe(false);
    expect(
      canAdvance("basics", {
        ...base,
        atmosphere: FORECAST_ATMOSPHERE,
        launchDatetime: "2026-06-01T09:54",
      }),
    ).toBe(true);
    expect(
      canAdvance("basics", {
        ...base,
        atmosphere: FORECAST_ATMOSPHERE,
        launchDatetime: "not-a-date",
      }),
    ).toBe(false);
  });

  it("advanced: always true — overrides are optional", () => {
    expect(
      canAdvance("advanced", {
        exportId: null,
        site: null,
        atmosphere: STANDARD_ATMOSPHERE,
        launchDatetime: null,
        result: null,
      }),
    ).toBe(true);
  });

  it("review: requires a result", () => {
    const progress = {
      exportId: "export-1",
      site: null,
      atmosphere: STANDARD_ATMOSPHERE,
      launchDatetime: null,
      result: null,
    };
    expect(canAdvance("review", progress)).toBe(false);
    expect(
      canAdvance("review", {
        ...progress,
        result: { run_id: "run-1", scalars: {}, plot_urls: [], warnings: [] },
      }),
    ).toBe(true);
  });

  it("results: always false — terminal step", () => {
    expect(
      canAdvance("results", {
        exportId: "export-1",
        site: null,
        atmosphere: STANDARD_ATMOSPHERE,
        launchDatetime: null,
        result: { run_id: "run-1", scalars: {}, plot_urls: [], warnings: [] },
      }),
    ).toBe(false);
  });
});
