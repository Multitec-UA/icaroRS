import { afterEach, describe, expect, it, vi } from "vitest";
import type { Atmosphere } from "@/lib/api";
import { mockBrowserTimeZone } from "@/test/mock-time-zone";
import {
  inputNumber,
  sameNumber,
  buildScenarioBody,
  FALLBACK_TIME_ZONE,
  canRun,
  draftFromScenario,
  canonicalScenario,
  scenarioDiff,
  formatLaunchDate,
  launchDateToIso,
  needsDate,
  outsideForecastWindow,
  resolveTimeZone,
  runBlocker,
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
        railOverrides: {},
      }, "Europe/Madrid"),
    ).toEqual({
      name: "acme-1",
      site: { latitude: 1, longitude: 2, elevation: 3 },
      // 09:54 in Madrid (CEST, UTC+2) is the 07 UTC hour.
      date: { year: 2026, month: 6, day: 1, hour: 7 },
      atmosphere: STANDARD_ATMOSPHERE,
      uncertainty: {},
    });
  });

  it("passes through a null site and a null launch date", () => {
    expect(
      buildScenarioBody({
        name: "acme-1",
        site: null,
        launchDatetime: null,
        atmosphere: STANDARD_ATMOSPHERE,
        railOverrides: {},
      }),
    ).toEqual({
      name: "acme-1",
      site: null,
      date: null,
      atmosphere: STANDARD_ATMOSPHERE,
      uncertainty: {},
    });
  });

  it("sends no rail key at all when nothing is overridden", () => {
    const body = buildScenarioBody({
      name: "acme-1",
      site: null,
      launchDatetime: null,
      atmosphere: STANDARD_ATMOSPHERE,
      railOverrides: {},
    });
    expect("rail" in body).toBe(false);
  });

  it("sends only the overridden rail keys, never the file's defaults", () => {
    const body = buildScenarioBody({
      name: "acme-1",
      site: null,
      launchDatetime: null,
      atmosphere: STANDARD_ATMOSPHERE,
      railOverrides: { inclination: 84 },
    });
    expect(body.rail).toEqual({ inclination: 84 });
  });

  it("always sends an empty uncertainty: the simulate use-case ignores it", () => {
    const body = buildScenarioBody({
      name: "acme-1",
      site: null,
      launchDatetime: null,
      atmosphere: STANDARD_ATMOSPHERE,
      railOverrides: { length: 3, heading: 45 },
    });
    expect(body.uncertainty).toEqual({});
    expect(body.rail).toEqual({ length: 3, heading: 45 });
  });
});

describe("canRun", () => {
  const ready = {
    exportId: "export-1",
    site: { latitude: 10, longitude: 20, elevation: null },
    atmosphere: STANDARD_ATMOSPHERE,
    launchDatetime: null,
  };

  it("requires an export", () => {
    expect(canRun(ready)).toBe(true);
    expect(canRun({ ...ready, exportId: null })).toBe(false);
  });

  it("requires a finite launch site", () => {
    expect(canRun({ ...ready, site: null })).toBe(false);
    expect(
      canRun({ ...ready, site: { latitude: Number.NaN, longitude: 20, elevation: null } }),
    ).toBe(false);
    expect(
      canRun({ ...ready, site: { latitude: 10, longitude: Number.POSITIVE_INFINITY, elevation: null } }),
    ).toBe(false);
  });

  it("requires a launch date only when the atmosphere model needs one", () => {
    expect(canRun({ ...ready, atmosphere: FORECAST_ATMOSPHERE })).toBe(false);
    expect(canRun({ ...ready, atmosphere: FORECAST_ATMOSPHERE, launchDatetime: "not-a-date" })).toBe(false);
    expect(
      canRun({ ...ready, atmosphere: FORECAST_ATMOSPHERE, launchDatetime: "2026-06-01T09:54" }),
    ).toBe(true);
  });
});

describe("runBlocker — the first unmet Run condition the button names (S12f)", () => {
  const ready = {
    exportId: "export-1",
    site: { latitude: 10, longitude: 20, elevation: null },
    atmosphere: FORECAST_ATMOSPHERE,
    launchDatetime: "2026-06-01T09:00",
  };

  it("names the site first, then the date, and nothing once Run can go", () => {
    expect(runBlocker({ ...ready, site: null, launchDatetime: null })).toBe("site");
    expect(runBlocker({ ...ready, site: { latitude: Number.NaN, longitude: 20, elevation: null } })).toBe("site");
    expect(runBlocker({ ...ready, launchDatetime: null })).toBe("date");
    expect(runBlocker({ ...ready, atmosphere: STANDARD_ATMOSPHERE, launchDatetime: null })).toBeNull();
    expect(runBlocker(ready)).toBeNull();
  });

  it("names nothing without a file: the import is the next step, not a field", () => {
    expect(runBlocker({ ...ready, exportId: null, site: null })).toBeNull();
  });
});

describe("outsideForecastWindow — when a forecast cannot cover the launch hour (S12e)", () => {
  const NOW = Date.UTC(2026, 9, 31, 10);

  it("is true more than 16 days ahead or once the launch hour is over, false in between", () => {
    expect(outsideForecastWindow("2026-11-07T11:00", NOW, "UTC")).toBe(false);
    expect(outsideForecastWindow("2026-11-16T10:00", NOW, "UTC")).toBe(false);
    expect(outsideForecastWindow("2026-11-16T11:00", NOW, "UTC")).toBe(true);
    expect(outsideForecastWindow("2026-10-31T10:00", NOW, "UTC")).toBe(false);
    expect(outsideForecastWindow("2026-10-31T09:00", NOW, "UTC")).toBe(true);
  });

  it("is false without a parseable date", () => {
    expect(outsideForecastWindow(null, NOW, "UTC")).toBe(false);
    expect(outsideForecastWindow("not-a-date", NOW, "UTC")).toBe(false);
  });
});

describe("canonicalScenario — the comparable form of a scenario body (S6)", () => {
  const body = {
    uncertainty: {},
    site: { longitude: -0.4810004, latitude: 38.345234, elevation: 12.04 },
    name: "my_scenario",
    atmosphere: { station: null, model: "forecast", fallback: "standard_atmosphere", file: null },
    date: { hour: 11, day: 7, month: 11, year: 2026 },
  };

  it("sorts keys at every level so key order never makes two bodies differ", () => {
    const canonical = canonicalScenario(body);
    expect(Object.keys(canonical)).toEqual(["atmosphere", "date", "name", "site"]);
    expect(Object.keys(canonical.atmosphere as object)).toEqual(["fallback", "file", "model", "station"]);
    expect(JSON.stringify(canonicalScenario({ ...body }))).toBe(
      JSON.stringify(canonicalScenario(Object.fromEntries(Object.entries(body).reverse()))),
    );
  });

  it("rounds coordinates to 5 decimals and the elevation to 1", () => {
    expect(canonicalScenario(body).site).toEqual({ elevation: 12, latitude: 38.34523, longitude: -0.481 });
  });

  it("drops uncertainty, whatever it holds", () => {
    expect(canonicalScenario({ ...body, uncertainty: { mass: 0.1 } })).not.toHaveProperty("uncertainty");
    expect(canonicalScenario({ ...body, uncertainty: null })).not.toHaveProperty("uncertainty");
  });

  it("keeps only the rail keys that carry a value, and no rail when none does", () => {
    expect(canonicalScenario({ ...body, rail: { length: 5.2, inclination: null } }).rail).toEqual({ length: 5.2 });
    expect(canonicalScenario({ ...body, rail: { length: null } })).not.toHaveProperty("rail");
    expect(canonicalScenario({ ...body, rail: null })).not.toHaveProperty("rail");
  });
});

describe("scenarioDiff — which input groups differ between two runs' inputs (S6)", () => {
  const base = {
    exportId: "exp-1",
    scenario: {
      name: "my_scenario",
      site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
      date: { year: 2026, month: 11, day: 7, hour: 11 },
      atmosphere: { model: "forecast", file: null, station: null, fallback: "standard_atmosphere" },
      uncertainty: {},
    },
  };
  const edit = (patch: Record<string, unknown>, exportId = "exp-1") => ({
    exportId,
    scenario: { ...base.scenario, ...patch },
  });

  it("is empty for the same scenario, even with noise below the rounding and a different uncertainty", () => {
    expect(scenarioDiff(base, edit({ site: { latitude: 38.345200001, longitude: -0.481, elevation: 12.01 }, uncertainty: null }))).toEqual([]);
  });

  it("names each changed group in a fixed order: file, site, date, weather, rail", () => {
    expect(
      scenarioDiff(
        base,
        edit(
          {
            rail: { heading: 90 },
            atmosphere: { ...base.scenario.atmosphere, model: "standard_atmosphere" },
            date: { ...base.scenario.date, hour: 12 },
            site: { ...base.scenario.site, elevation: 40 },
          },
          "exp-2",
        ),
      ),
    ).toEqual(["file", "site", "date", "weather", "rail"]);
  });

  it("counts an elevation-only edit as a site change and a fallback-only edit as weather", () => {
    expect(scenarioDiff(base, edit({ site: { ...base.scenario.site, elevation: 100 } }))).toEqual(["site"]);
    expect(
      scenarioDiff(base, edit({ atmosphere: { ...base.scenario.atmosphere, fallback: "other" } })),
    ).toEqual(["weather"]);
  });

  it("treats a rail override that was reset as no rail at all", () => {
    expect(scenarioDiff(edit({ rail: { length: 5 } }), base)).toEqual(["rail"]);
    expect(scenarioDiff(edit({ rail: {} }), base)).toEqual([]);
  });
});

describe("draftFromScenario — a stored run's scenario back into the draft (S8)", () => {
  const STORED = {
    name: "workbench",
    site: { latitude: 38.2655, longitude: -0.6981, elevation: 42 },
    date: { year: 2026, month: 11, day: 7, hour: 10 },
    atmosphere: { model: "forecast", fallback: "standard_atmosphere", file: "GFS", station: null },
    rail: { length: 5.2, inclination: 85, heading: 90 },
    uncertainty: {},
  };

  it("maps site, atmosphere and rail verbatim and the UTC date to the user's wall clock", () => {
    const draft = draftFromScenario(STORED, "Europe/Madrid");
    expect(draft.name).toBe("workbench");
    expect(draft.site).toEqual(STORED.site);
    // 10:00 UTC on 7 Nov 2026 is 11:00 in Madrid (CET, UTC+1).
    expect(draft.launchDatetime).toBe("2026-11-07T11:00");
    expect(draft.atmosphere).toEqual(STORED.atmosphere);
    expect(draft.railOverrides).toEqual({ length: 5.2, inclination: 85, heading: 90 });
  });

  it("round-trips: the draft rebuilds the canonical stored body", () => {
    for (const timeZone of ["Europe/Madrid", "America/New_York", "Asia/Kolkata", "UTC"]) {
      const body = buildScenarioBody(draftFromScenario(STORED, timeZone), timeZone);
      expect(canonicalScenario(body)).toEqual(canonicalScenario(STORED));
    }
  });

  it("keeps only the rail keys present and tolerates a missing date, rail and atmosphere", () => {
    const draft = draftFromScenario(
      { site: { latitude: 1, longitude: 2 }, date: null, rail: { length: null, heading: 45 } },
      "UTC",
    );
    expect(draft.railOverrides).toEqual({ heading: 45 });
    expect(draft.launchDatetime).toBeNull();
    expect(draft.atmosphere.model).toBe("standard_atmosphere");
    expect(draft.name).toBe("my_scenario");
    expect(draftFromScenario(null, "UTC").site).toBeNull();
  });
});

describe("manual wind on the pad (launch-day S6a)", () => {
  const draft = {
    name: "acme-1",
    site: null,
    launchDatetime: null,
    atmosphere: STANDARD_ATMOSPHERE,
    railOverrides: {},
  };

  it("sends no wind key while the switch is on the forecast", () => {
    expect("wind" in buildScenarioBody(draft)).toBe(false);
    expect("wind" in buildScenarioBody({ ...draft, wind: null })).toBe(false);
  });

  it("sends the measured wind in m/s with the direction it comes from", () => {
    const body = buildScenarioBody({ ...draft, wind: { speedKmh: 18, directionFrom: 270 } });
    expect(body.wind).toEqual({ speed: 5, direction_from: 270 });
    expect(buildScenarioBody({ ...draft, wind: { speedKmh: 10, directionFrom: 45 } }).wind).toEqual({
      speed: 2.778,
      direction_from: 45,
    });
  });

  it("keeps the wind in the canonical form, rounded, so a wind change is a change", () => {
    const canonical = canonicalScenario({ name: "x", wind: { direction_from: 270.04, speed: 5.0001 } });
    expect(canonical.wind).toEqual({ direction_from: 270, speed: 5 });
    expect(canonicalScenario({ name: "x", wind: null })).not.toHaveProperty("wind");
  });

  it("reports a wind change in the weather group", () => {
    const a = { exportId: "e", scenario: { name: "x", atmosphere: STANDARD_ATMOSPHERE } };
    const b = { exportId: "e", scenario: { ...a.scenario, wind: { speed: 5, direction_from: 270 } } };
    expect(scenarioDiff(a, b)).toEqual(["weather"]);
    expect(scenarioDiff(b, b)).toEqual([]);
  });

  it("reads a stored wind back into the draft in km/h, and none when absent", () => {
    expect(draftFromScenario({ wind: { speed: 5, direction_from: 270 } }).wind).toEqual({
      speedKmh: 18,
      directionFrom: 270,
    });
    expect(draftFromScenario({}).wind).toBeUndefined();
  });
});

describe("inputNumber / sameNumber (units S5)", () => {
  it("shows metric values untouched and imperial ones to the hundredth", () => {
    expect(inputNumber(30.123456, "metric")).toBe(30.123456);
    expect(inputNumber(5.2 * 3.28084, "imperial")).toBe(17.06);
    expect(inputNumber((100 / 3.28084) * 3.28084, "imperial")).toBe(100);
    expect(inputNumber(-0.001, "imperial")).toBe(0);
  });

  it("treats a unit round trip as the same number, a real edit as different", () => {
    expect(sameNumber(10, (10 / 3.28084) * 3.28084)).toBe(true);
    expect(sameNumber(84, 84)).toBe(true);
    expect(sameNumber(10, 10.01)).toBe(false);
    expect(sameNumber(0, 1e-12)).toBe(true);
  });
});
