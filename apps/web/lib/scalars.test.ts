import { describe, expect, it } from "vitest";
import { formatScalar } from "./scalars";

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
