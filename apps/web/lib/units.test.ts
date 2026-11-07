import { describe, expect, it } from "vitest";
import {
  UNITS_COOKIE,
  convert,
  formatMeasure,
  fromSi,
  resolveUnitSystem,
  toSi,
  unitLabel,
} from "./units";

describe("resolveUnitSystem (cookie)", () => {
  it("defaults to metric and only accepts the two known values", () => {
    expect(resolveUnitSystem(undefined)).toBe("metric");
    expect(resolveUnitSystem("")).toBe("metric");
    expect(resolveUnitSystem("imperial")).toBe("imperial");
    expect(resolveUnitSystem("metric")).toBe("metric");
    expect(resolveUnitSystem("furlongs")).toBe("metric");
    expect(UNITS_COOKIE).toBe("icaro-units");
  });
});

describe("conversion", () => {
  it("is the identity in metric", () => {
    expect(fromSi(123.4, "length", "metric")).toBe(123.4);
    expect(toSi(123.4, "length", "metric")).toBe(123.4);
    expect(unitLabel("length", "metric")).toBe("m");
  });

  it("maps every kind to the L1 rulebook units in imperial", () => {
    expect(unitLabel("length", "imperial")).toBe("ft");
    expect(unitLabel("distance", "imperial")).toBe("mi");
    expect(unitLabel("speed", "imperial")).toBe("ft/s");
    expect(unitLabel("windSpeed", "imperial")).toBe("mph");
    expect(unitLabel("mass", "imperial")).toBe("lb");
    expect(unitLabel("diameter", "imperial")).toBe("in");
    expect(unitLabel("acceleration", "imperial")).toBe("ft/s²");
    expect(unitLabel("impulse", "imperial")).toBe("N·s");
    expect(unitLabel("angle", "imperial")).toBe("°");
  });

  it("converts with the standard factors", () => {
    expect(fromSi(1, "length", "imperial")).toBeCloseTo(3.28084, 5);
    expect(fromSi(1, "speed", "imperial")).toBeCloseTo(3.28084, 5);
    expect(fromSi(10.7, "speed", "imperial")).toBeCloseTo(35.1, 1); // L1: 35 ft/s ≈ 10.7 m/s
    expect(fromSi(32, "windSpeed", "imperial")).toBeCloseTo(19.88, 2); // km/h → mph
    expect(fromSi(1, "mass", "imperial")).toBeCloseTo(2.20462, 5);
    expect(fromSi(25.4, "diameter", "imperial")).toBeCloseTo(1, 6); // mm → in
    expect(fromSi(1, "distance", "imperial")).toBeCloseTo(0.621371, 6); // km → mi
    expect(fromSi(235, "impulse", "imperial")).toBe(235);
  });

  it("round-trips and keeps zero", () => {
    for (const kind of ["length", "speed", "windSpeed", "mass", "diameter", "acceleration"] as const) {
      expect(toSi(fromSi(42.5, kind, "imperial"), kind, "imperial")).toBeCloseTo(42.5, 9);
      expect(fromSi(0, kind, "imperial")).toBe(0);
    }
  });

  it("converts between the two display units of a kind", () => {
    expect(convert(1, "length", "metric", "imperial")).toBeCloseTo(3.28084, 5);
    expect(convert(3.28084, "length", "imperial", "metric")).toBeCloseTo(1, 5);
  });
});

describe("formatMeasure", () => {
  it("keeps today's metric rendering byte-identical", () => {
    expect(formatMeasure(816.4, "length", "metric", "en")).toBe("816 m");
    expect(formatMeasure(18.14, "speed", "metric", "en")).toBe("18.1 m/s");
    expect(formatMeasure(1.656, "mass", "metric", "es")).toBe("1,66 kg");
    expect(formatMeasure(null, "length", "metric", "en")).toBe("—");
  });

  it("renders the converted value with the imperial label", () => {
    expect(formatMeasure(816.4, "length", "imperial", "en")).toBe("2,678 ft");
    expect(formatMeasure(10.7, "speed", "imperial", "en")).toBe("35.1 ft/s");
    expect(formatMeasure(32, "windSpeed", "imperial", "en")).toBe("19.9 mph");
    expect(formatMeasure(1.656, "mass", "imperial", "en")).toBe("3.65 lb");
  });
});
