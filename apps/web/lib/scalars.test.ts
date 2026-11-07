import { describe, expect, it } from "vitest";
import { unitLabel } from "./units";
import { SCALAR_SPECS, formatScalar, formatScalarIn } from "./scalars";

describe("formatScalar — null / non-finite handling", () => {
  it("renders null as an em dash", () => {
    expect(formatScalar(null, "m")).toBe("—");
  });

  it("renders NaN as an em dash", () => {
    expect(formatScalar(Number.NaN, "m")).toBe("—");
  });

  it("renders Infinity as an em dash", () => {
    expect(formatScalar(Number.POSITIVE_INFINITY, "m")).toBe("—");
    expect(formatScalar(Number.NEGATIVE_INFINITY, "m")).toBe("—");
  });
});

describe("formatScalar — digit selection at the 10 / 100 boundaries", () => {
  // The boundary check (`abs >= 100 ? 0 : abs >= 10 ? 1 : 2`) runs on the raw
  // value, before rounding — these values are chosen so the digit count is
  // unambiguous even after rounding is applied.
  it("uses 2 fraction digits below 10", () => {
    expect(formatScalar(9.567, "", "en")).toBe("9.57");
  });

  it("uses 1 fraction digit at and above 10 (below 100)", () => {
    expect(formatScalar(10.567, "", "en")).toBe("10.6");
    expect(formatScalar(99.567, "", "en")).toBe("99.6");
  });

  it("uses 0 fraction digits at and above 100", () => {
    expect(formatScalar(100.567, "", "en")).toBe("101");
    expect(formatScalar(1234.4, "", "en")).toBe("1,234");
  });

  it("applies the same boundaries to negative values via abs()", () => {
    expect(formatScalar(-9.567, "", "en")).toBe("-9.57");
    expect(formatScalar(-100.567, "", "en")).toBe("-101");
  });

  it("drops trailing fraction zeros (minimumFractionDigits: 0)", () => {
    expect(formatScalar(5, "", "en")).toBe("5");
    expect(formatScalar(50, "", "en")).toBe("50");
  });
});

describe("formatScalar — unit suffix and locale", () => {
  it("appends the unit with a separating space when given", () => {
    expect(formatScalar(5, "m", "en")).toBe("5 m");
  });

  it("omits the separator entirely for an empty unit", () => {
    expect(formatScalar(5, "", "en")).toBe("5");
  });

  it("defaults to the en locale when none is given", () => {
    expect(formatScalar(1234.4, "")).toBe("1,234");
  });

  it("groups thousands per the given locale", () => {
    expect(formatScalar(12345.678, "", "en")).toBe("12,346");
    expect(formatScalar(12345.678, "", "es")).toBe("12.346");
  });
});

describe("formatScalarIn — the scalar in the unit system in effect", () => {
  it("every spec's metric label is its historical unit, so metric output is unchanged", () => {
    for (const spec of SCALAR_SPECS) {
      expect(unitLabel(spec.kind, "metric")).toBe(spec.unit);
      expect(formatScalarIn(1234.4, spec, "metric", "en")).toBe(formatScalar(1234.4, spec.unit, "en"));
    }
  });

  it("converts lengths, speeds and accelerations to imperial and keeps the rest", () => {
    const spec = (key: string) => SCALAR_SPECS.find((s) => s.key === key)!;
    expect(formatScalarIn(816.4, spec("apogee_m"), "imperial", "en")).toBe("2,678 ft");
    expect(formatScalarIn(10.7, spec("impact_velocity_ms"), "imperial", "en")).toBe("35.1 ft/s");
    expect(formatScalarIn(95.3, spec("max_acceleration_ms2"), "imperial", "en")).toBe("313 ft/s²");
    expect(formatScalarIn(1.93, spec("rail_departure_stability_margin"), "imperial", "en")).toBe("1.93 cal");
    expect(formatScalarIn(21.8, spec("apogee_time_s"), "imperial", "en")).toBe("21.8 s");
    expect(formatScalarIn(0.84, spec("max_mach"), "imperial", "en")).toBe("0.84");
    expect(formatScalarIn(null, spec("apogee_m"), "imperial", "en")).toBe("—");
  });
});

describe("SCALAR_SPECS — rail-exit margin with wind and angle of attack", () => {
  const spec = (key: string) => SCALAR_SPECS.find((s) => s.key === key)!;

  it("formats the margin with wind in calibres in both systems and links its glossary term", () => {
    const wind = spec("rail_departure_stability_margin_wind");
    expect(wind.term).toBe("stability_margin_wind");
    expect(formatScalarIn(4.423, wind, "metric", "en")).toBe("4.42 cal");
    expect(formatScalarIn(4.423, wind, "imperial", "en")).toBe("4.42 cal");
    expect(formatScalarIn(4.423, wind, "metric", "es")).toBe("4,42 cal");
  });

  it("formats the angle of attack in degrees in both systems", () => {
    const aoa = spec("rail_departure_angle_of_attack_deg");
    expect(formatScalarIn(6.97, aoa, "metric", "en")).toBe("6.97 °");
    expect(formatScalarIn(6.97, aoa, "imperial", "en")).toBe("6.97 °");
  });

  it("lists the margin with wind right after the static margin", () => {
    const keys = SCALAR_SPECS.map((s) => s.key);
    const at = keys.indexOf("rail_departure_stability_margin");
    expect(keys.slice(at, at + 3)).toEqual([
      "rail_departure_stability_margin",
      "rail_departure_stability_margin_wind",
      "rail_departure_angle_of_attack_deg",
    ]);
  });
});
