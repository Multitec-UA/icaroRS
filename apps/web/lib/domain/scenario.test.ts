import { afterEach, describe, expect, it, vi } from "vitest";
import type { Atmosphere } from "@/lib/api";
import { mockBrowserTimeZone } from "@/test/mock-time-zone";
import {
  STEP_ORDER,
  buildScenarioBody,
  FALLBACK_TIME_ZONE,
  canAdvance,
  formatLaunchDate,
  launchDateToIso,
  needsDate,
  resolveTimeZone,
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
    expect(toLaunchDate(null, "UTC")).toBeNull();
  });

  it("keeps the wall-clock hour unchanged when the time zone is UTC", () => {
    expect(toLaunchDate("2026-06-01T09:54", "UTC")).toEqual({
      year: 2026,
      month: 6,
      day: 1,
      hour: 9,
    });
  });

  it("converts a Madrid summer-time wall clock (CEST, UTC+2) to the UTC hour", () => {
    expect(toLaunchDate("2026-10-24T10:00", "Europe/Madrid")).toEqual({
      year: 2026,
      month: 10,
      day: 24,
      hour: 8,
    });
  });

  it("converts a Madrid winter-time wall clock (CET, UTC+1) after the DST change", () => {
    expect(toLaunchDate("2026-10-26T10:00", "Europe/Madrid")).toEqual({
      year: 2026,
      month: 10,
      day: 26,
      hour: 9,
    });
  });

  it("rolls the UTC date back when the local time is just after midnight", () => {
    expect(toLaunchDate("2026-10-24T01:00", "Europe/Madrid")).toEqual({
      year: 2026,
      month: 10,
      day: 23,
      hour: 23,
    });
  });

  it("rolls the UTC date forward for a zone west of UTC", () => {
    expect(toLaunchDate("2026-06-01T21:00", "America/New_York")).toEqual({
      year: 2026,
      month: 6,
      day: 2,
      hour: 1,
    });
  });

  it("returns null for a malformed string", () => {
    expect(toLaunchDate("not-a-date", "UTC")).toBeNull();
  });
});

describe("resolveTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the browser's IANA time zone", () => {
    mockBrowserTimeZone("America/Bogota");
    expect(resolveTimeZone()).toBe("America/Bogota");
  });

  it("falls back to Spain when the browser reports no time zone", () => {
    mockBrowserTimeZone(undefined);
    expect(resolveTimeZone()).toBe("Europe/Madrid");
    expect(FALLBACK_TIME_ZONE).toBe("Europe/Madrid");
  });

  it("falls back to Spain when the browser reports an unknown time zone", () => {
    mockBrowserTimeZone("Not/AZone");
    expect(resolveTimeZone()).toBe("Europe/Madrid");
  });
});

describe("launchDateToIso", () => {
  it("serializes the UTC launch date as an explicit-offset ISO string", () => {
    expect(launchDateToIso({ year: 2026, month: 10, day: 24, hour: 8 })).toBe(
      "2026-10-24T08:00:00+00:00",
    );
  });
});

describe("formatLaunchDate", () => {
  it("renders the UTC launch date in the given zone, with the zone name", () => {
    const text = formatLaunchDate({ year: 2026, month: 10, day: 24, hour: 8 }, "es", "Europe/Madrid");
    expect(text).toContain("24/10/2026");
    expect(text).toContain("10:00");
    expect(text).not.toContain("UTC");
  });

  it("renders UTC unchanged when the zone is UTC", () => {
    const text = formatLaunchDate({ year: 2026, month: 10, day: 24, hour: 8 }, "en", "UTC");
    expect(text).toContain("08:00");
    expect(text).toContain("UTC");
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
      }, "Europe/Madrid"),
    ).toEqual({
      name: "acme-1",
      site: { latitude: 1, longitude: 2, elevation: 3 },
      // 09:54 in Madrid (CEST, UTC+2) is the 07 UTC hour.
      date: { year: 2026, month: 6, day: 1, hour: 7 },
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
