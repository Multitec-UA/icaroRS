import { describe, expect, it } from "vitest";
import {
  MC_DEFAULT_FLIGHTS,
  MC_MAX_FLIGHTS,
  MC_MIN_FLIGHTS,
  apogeeHistogram,
  budgetItems,
  ellipseCoverage,
  landingSummary,
  clampFlights,
  ellipseLayers,
  ellipsePositions,
  estimateMinutes,
  flightCounts,
  isMonteCarloActive,
  monteCarloPollInterval,
  progressFraction,
  queueAhead,
} from "./montecarlo";

describe("flight count bounds (S9: 10 ≤ n ≤ 500)", () => {
  it("defaults to 100 within 10..500", () => {
    expect([MC_MIN_FLIGHTS, MC_DEFAULT_FLIGHTS, MC_MAX_FLIGHTS]).toEqual([10, 100, 500]);
  });

  it("clamps, rounds and falls back to the default for a non-number", () => {
    expect(clampFlights(3)).toBe(10);
    expect(clampFlights(900)).toBe(500);
    expect(clampFlights(42.6)).toBe(43);
    expect(clampFlights(Number.NaN)).toBe(100);
  });

  it("estimates whole minutes at ~0.4 s per flight, never under one", () => {
    expect(estimateMinutes(10)).toBe(1);
    expect(estimateMinutes(100)).toBe(1);
    expect(estimateMinutes(300)).toBe(2);
    expect(estimateMinutes(500)).toBe(4);
  });
});

describe("status and progress", () => {
  it("is active while queued or running only", () => {
    expect(isMonteCarloActive("queued")).toBe(true);
    expect(isMonteCarloActive("running")).toBe(true);
    expect(isMonteCarloActive("done")).toBe(false);
    expect(isMonteCarloActive("error")).toBe(false);
  });

  it("polls every 2 s while active and stops on done/error or no data", () => {
    expect(monteCarloPollInterval("queued")).toBe(2000);
    expect(monteCarloPollInterval("running")).toBe(2000);
    expect(monteCarloPollInterval("done")).toBe(false);
    expect(monteCarloPollInterval("error")).toBe(false);
    expect(monteCarloPollInterval(undefined)).toBe(false);
  });

  it("turns progress into a 0..1 fraction", () => {
    expect(progressFraction({ done: 42, total: 100 })).toBeCloseTo(0.42);
    expect(progressFraction({ done: 0, total: 0 })).toBe(0);
    expect(progressFraction({ done: 120, total: 100 })).toBe(1);
  });

  it("counts the runs ahead in the queue (0 = next or running)", () => {
    expect(queueAhead(3)).toBe(3);
    expect(queueAhead(0)).toBe(0);
    expect(queueAhead(null)).toBe(0);
  });
});

describe("apogeeHistogram", () => {
  it("splits the values into equal-width bins covering min..max", () => {
    const bins = apogeeHistogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], 12);
    expect(bins).toHaveLength(12);
    expect(bins[0]).toMatchObject({ from: 0, count: 1 });
    expect(bins[11].to).toBe(11);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(12);
  });

  it("puts the maximum in the last bin", () => {
    const bins = apogeeHistogram([100, 150, 200], 2);
    expect(bins.map((bin) => bin.count)).toEqual([1, 2]);
  });

  it("gives one bin when every value is the same, none when empty", () => {
    expect(apogeeHistogram([500, 500, 500])).toEqual([{ from: 500, to: 500, count: 3 }]);
    expect(apogeeHistogram([])).toEqual([]);
  });

  it("ignores non-finite values", () => {
    const bins = apogeeHistogram([1, Number.NaN, 3], 2);
    expect(bins.reduce((sum, bin) => sum + bin.count, 0)).toBe(2);
  });
});

describe("ellipses", () => {
  it("maps [lat, lon] pairs to Leaflet positions, dropping malformed points", () => {
    expect(ellipsePositions([[38.1, -0.6], [38.2], [Number.NaN, 1], [38.3, -0.5]])).toEqual([
      [38.1, -0.6],
      [38.3, -0.5],
    ]);
  });

  it("pairs each landing polygon with its sigma, fainter as sigma grows", () => {
    const layers = ellipseLayers({
      ellipse_sigmas: [1, 2, 3],
      landing_ellipses: [
        [[1, 1], [1, 2], [2, 2]],
        [[0, 0], [0, 3], [3, 3]],
        [],
      ],
    });
    expect(layers.map((layer) => layer.sigma)).toEqual([1, 2]);
    expect(layers[0].positions).toEqual([[1, 1], [1, 2], [2, 2]]);
    expect(layers[0].fillOpacity).toBeGreaterThan(layers[1].fillOpacity);
  });
});

describe("flightCounts", () => {
  it("reads attempted, succeeded and failed flights", () => {
    expect(flightCounts({ n_requested: 100, n_succeeded: 97, n_failed: 3 })).toEqual({
      attempted: 100,
      succeeded: 97,
      failed: 3,
    });
  });
});

describe("budget items (S15) — what the run dispersed, in display units", () => {
  it("relative entries become percentages and angles stay in degrees, in a fixed order", () => {
    expect(
      budgetItems({
        rail_length: { std: 0.05, kind: "relative" },
        heading: { std: 2, kind: "absolute" },
        mass: { std: 0.05, kind: "relative" },
        inclination: { std: 2, kind: "absolute" },
        wind_factor: { std: 0.1, kind: "relative" },
        thrust: { std: 0.03, kind: "relative" },
      }),
    ).toEqual([
      { key: "mass", amount: 5, unit: "%" },
      { key: "thrust", amount: 3, unit: "%" },
      { key: "wind_factor", amount: 10, unit: "%" },
      { key: "angles", amount: 2, unit: "°" },
      { key: "rail_length", amount: 5, unit: "%" },
    ]);
  });

  it("keeps inclination and heading apart when they differ, and absolute rail length in metres", () => {
    expect(
      budgetItems({
        inclination: { std: 1, kind: "absolute" },
        heading: { std: 3, kind: "absolute" },
        rail_length: { std: 0.02, kind: "absolute" },
      }),
    ).toEqual([
      { key: "inclination", amount: 1, unit: "°" },
      { key: "heading", amount: 3, unit: "°" },
      { key: "rail_length", amount: 0.02, unit: "m" },
    ]);
  });

  it("keeps one decimal only when needed and omits missing or unknown keys", () => {
    expect(budgetItems({ mass: { std: 0.025, kind: "relative" }, spin: { std: 1, kind: "absolute" } })).toEqual([
      { key: "mass", amount: 2.5, unit: "%" },
    ]);
    expect(budgetItems({ thrust: { std: 0.03000000004, kind: "relative" } })).toEqual([
      { key: "thrust", amount: 3, unit: "%" },
    ]);
  });

  it("an empty budget (runs stored before S15) has no items", () => {
    expect(budgetItems({})).toEqual([]);
    expect(budgetItems(undefined)).toEqual([]);
  });
});

describe("landing summary (S15) — mean impact point from the launch site", () => {
  it("a mean impact of (120, 5) is about 120 m to the east", () => {
    expect(landingSummary([110, 130], [0, 10])).toEqual({ distance: 120, direction: "E" });
  });

  it("rounds the bearing to the nearest of 8 compass points", () => {
    const dir = (x: number, y: number) => landingSummary([x], [y])?.direction;
    expect([dir(0, 50), dir(50, 50), dir(50, 0), dir(50, -50), dir(0, -50), dir(-50, -50), dir(-50, 0), dir(-50, 50)]).toEqual([
      "N", "NE", "E", "SE", "S", "SW", "W", "NW",
    ]);
    expect(dir(-10, 100)).toBe("N"); // 354° rounds back to north
    expect(dir(30, 100)).toBe("N"); // 16.7°
    expect(dir(50, 100)).toBe("NE"); // 26.6°
  });

  it("rounds the distance to whole metres, and to 10 m from 100 m up", () => {
    expect(landingSummary([30], [40])?.distance).toBe(50);
    expect(landingSummary([7.4], [0])?.distance).toBe(7);
    expect(landingSummary([0], [-1234])).toEqual({ distance: 1230, direction: "S" });
  });

  it("ignores non-finite pairs and has no summary without impacts", () => {
    expect(landingSummary([100, Number.NaN], [0, 5])).toEqual({ distance: 100, direction: "E" });
    expect(landingSummary([], [])).toBeNull();
    expect(landingSummary([Number.NaN], [1])).toBeNull();
  });
});

describe("ellipse coverage (S15) — share of landings inside kσ (2-D normal)", () => {
  it("is ≈ 39 %, 86 % and 99 % for 1σ, 2σ and 3σ", () => {
    expect([1, 2, 3].map((sigma) => Math.round(ellipseCoverage(sigma) * 100))).toEqual([39, 86, 99]);
  });
});
