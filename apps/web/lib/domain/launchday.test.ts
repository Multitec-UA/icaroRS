import { describe, expect, it } from "vitest";
import type { LaunchCandidate, LaunchCheck } from "@/lib/api/launchday";
import {
  CHECK_KIND,
  DEFAULT_FLIGHT_COUNT,
  approxDistance,
  measureDecimals,
  checkStatus,
  compassPoint,
  headline,
  kmhToMs,
  msToKmh,
  requirementLabel,
  statusTone,
  topCandidates,
} from "./launchday";

function candidate(overrides: Partial<LaunchCandidate> = {}): LaunchCandidate {
  return {
    inclination: 86,
    heading: 240,
    apogee_agl: 540,
    landing_distance: 123,
    landing_bearing: 44,
    out_of_rail_velocity: 22.1,
    stability_margin_min: 1.8,
    impact_velocity: 5.6,
    checks_ok: true,
    ...overrides,
  };
}

function check(overrides: Partial<LaunchCheck> = {}): LaunchCheck {
  return {
    id: "apogee_max",
    value: 540,
    limit: 1000,
    comparator: "<=",
    ok: true,
    severity: "hard",
    source: "PROP-003",
    ...overrides,
  };
}

describe("km/h ↔ m/s", () => {
  it("converts both ways", () => {
    expect(kmhToMs(36)).toBe(10);
    expect(kmhToMs(18)).toBe(5);
    expect(msToKmh(5)).toBe(18);
    expect(msToKmh(kmhToMs(17))).toBe(17);
  });
});

describe("compassPoint — 8-point direction from degrees", () => {
  it.each([
    [0, "N"],
    [44, "NE"],
    [90, "E"],
    [135, "SE"],
    [180, "S"],
    [240, "SW"],
    [270, "W"],
    [315, "NW"],
    [359, "N"],
    [-90, "W"],
    [360, "N"],
  ])("%s° is %s", (degrees, point) => {
    expect(compassPoint(degrees)).toBe(point);
  });
});

describe("approxDistance", () => {
  it("rounds to 10 m from 100 m up, to the metre below", () => {
    expect(approxDistance(123.4)).toBe(120);
    expect(approxDistance(87.6)).toBe(88);
  });
});

describe("headline — the best setting in words", () => {
  it("names the setting, its heading point, and where it lands", () => {
    expect(headline(candidate())).toEqual({
      inclination: 86,
      heading: 240,
      headingPoint: "SW",
      distance: 120,
      landingPoint: "NE",
      passes: true,
    });
  });

  it("says when the closest setting fails a hard check", () => {
    expect(headline(candidate({ checks_ok: false })).passes).toBe(false);
  });

  it("rounds the distance in feet for imperial (123.4 m ≈ 405 ft → about 400)", () => {
    expect(headline(candidate(), "imperial").distance).toBe(400);
    expect(headline(candidate(), "metric")).toEqual(headline(candidate()));
  });
});

describe("CHECK_KIND / measureDecimals (units S6)", () => {
  it("measures every check with its kind", () => {
    expect(CHECK_KIND).toEqual({
      apogee_max: "length",
      apogee_recommended: "length",
      tilt_max: "angle",
      static_margin_min: "stability",
      descent_max: "speed",
      descent_recommended: "speed",
      landing_radius: "length",
      rail_exit_min: "speed",
      wind_max: "windSpeed",
    });
  });

  it("keeps the metric decimals and gives mph a tenth", () => {
    expect(measureDecimals("length", "metric")).toBe(0);
    expect(measureDecimals("speed", "metric")).toBe(1);
    expect(measureDecimals("angle", "metric")).toBe(1);
    expect(measureDecimals("stability", "metric")).toBe(2);
    expect(measureDecimals("windSpeed", "metric")).toBe(0);
    expect(measureDecimals("windSpeed", "imperial")).toBe(1);
    expect(measureDecimals("length", "imperial")).toBe(0);
  });
});

describe("checkStatus / statusTone", () => {
  it("maps ok → green, soft fail → amber, hard fail → red", () => {
    expect(checkStatus(check())).toBe("ok");
    expect(checkStatus(check({ ok: false, severity: "soft" }))).toBe("soft");
    expect(checkStatus(check({ ok: false, severity: "hard" }))).toBe("hard");
    expect(statusTone("ok")).toBe("ok");
    expect(statusTone("soft")).toBe("warn");
    expect(statusTone("hard")).toBe("bad");
  });
});

describe("requirementLabel", () => {
  it("prefixes short guide ids, keeps full ids, names common practice", () => {
    expect(requirementLabel("REC-003")).toBe("SURTSR-L1-REC-003");
    expect(requirementLabel("SURTSR-L1-PROP-004")).toBe("SURTSR-L1-PROP-004");
    expect(requirementLabel("practice")).toBeNull();
  });
});

describe("topCandidates", () => {
  it("keeps the first 8 by landing distance", () => {
    const list = Array.from({ length: 12 }, (_, i) => candidate({ heading: i * 30, landing_distance: 500 - i * 10 }));
    const top = topCandidates(list);
    expect(top).toHaveLength(8);
    expect(top[0].landing_distance).toBe(390);
    expect(top.map((c) => c.landing_distance)).toEqual([...top.map((c) => c.landing_distance)].sort((a, b) => a - b));
  });

  it("the default grid is 6 inclinations × 12 headings", () => {
    expect(DEFAULT_FLIGHT_COUNT).toBe(72);
  });
});
