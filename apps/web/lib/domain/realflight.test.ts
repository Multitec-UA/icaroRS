import { describe, expect, it } from "vitest";
import type { FlightComparison, RealFlightSummary } from "@/lib/api";
import {
  chartData,
  eventRows,
  flightOptionParts,
  kpiRows,
  linePath,
  peak,
  rmseRows,
  signed,
  valueRange,
  warningKey,
} from "./realflight";

/** real-flight-compare S6: the pure rules behind the "Real flight" card. */

function comparison(overrides: Partial<FlightComparison> = {}): FlightComparison {
  return {
    run_id: "run-1",
    flight_id: "MT1-00279",
    real_flight: { flight_id: "MT1-00279", rocket: "MT1", stats: {} },
    approximate: false,
    series: {
      t: [0, 1, 2, 3],
      sim: { alt_m: [0, 10, 20, 15], vz_ms: [0, 10, 0, -5] },
      real: { alt_m: [0, 8, 18, null], vz_ms: [0, 9, -1, null] },
    },
    events: [],
    kpis: [],
    rmse: { alt_m: 2.1, vz_ms: null, acc_ms2: null },
    window: { t_start: 0, t_end: 2 },
    warnings: [],
    ...overrides,
  };
}

describe("chartData", () => {
  it("pairs both sides on the shared grid", () => {
    expect(chartData(comparison(), "alt_m")).toEqual({ t: [0, 1, 2, 3], sim: [0, 10, 20, 15], real: [0, 8, 18, null] });
  });

  it("fills a side that lacks the series with gaps, and skips a series nobody has", () => {
    const c = comparison({ series: { t: [0, 1], sim: { acc_ms2: [9.8, 50] }, real: {} } });
    expect(chartData(c, "acc_ms2")).toEqual({ t: [0, 1], sim: [9.8, 50], real: [null, null] });
    expect(chartData(c, "vz_ms")).toBeNull();
  });
});

describe("valueRange and peak", () => {
  it("keeps zero on the axis and spans negatives", () => {
    expect(valueRange({ t: [0, 1], sim: [5, 10], real: [6, null] })).toEqual({ min: 0, max: 10 });
    expect(valueRange({ t: [0, 1], sim: [-5, 10], real: [null, null] })).toEqual({ min: -5, max: 10 });
    expect(valueRange({ t: [0, 1], sim: [-5, -1], real: [null, null] })).toEqual({ min: -5, max: 0 });
  });

  it("is null without data and never flat", () => {
    expect(valueRange({ t: [0], sim: [null], real: [null] })).toBeNull();
    expect(valueRange({ t: [0], sim: [0], real: [0] })).toEqual({ min: 0, max: 1 });
  });

  it("peak ignores gaps", () => {
    expect(peak([1, null, 7, 3])).toBe(7);
    expect(peak([null])).toBeNull();
  });
});

describe("linePath", () => {
  const sx = (t: number) => t * 10;
  const sy = (v: number) => 100 - v;

  it("moves to the first point and lines to the rest", () => {
    expect(linePath([0, 1, 2], [0, 10, 20], sx, sy)).toBe("M0.0,100.0 L10.0,90.0 L20.0,80.0");
  });

  it("breaks the line across a gap instead of drawing zero", () => {
    expect(linePath([0, 1, 2, 3], [5, null, 7, 8], sx, sy)).toBe("M0.0,95.0 M20.0,93.0 L30.0,92.0");
  });

  it("thins long series but keeps the last sample", () => {
    const t = Array.from({ length: 1000 }, (_, i) => i);
    const path = linePath(t, t, sx, sy, 100);
    const vertices = path.split(" ");
    expect(vertices.length).toBeLessThanOrEqual(101);
    expect(vertices.at(-1)).toBe("L9990.0,-899.0");
  });
});

describe("kpiRows and rmseRows", () => {
  it("orders the headline numbers and drops unknown or empty ones", () => {
    const rows = kpiRows([
      { id: "landing_t", unit: "s", sim: 148.7, real: 120, delta: 28.7, delta_pct: 23.9 },
      { id: "apogee_m", unit: "m", sim: 571.4, real: 459, delta: 112.4, delta_pct: 24.5 },
      { id: "amax_ms2", unit: "m/s²", sim: null, real: null, delta: null, delta_pct: null },
      { id: "mystery", unit: "", sim: 1, real: 1, delta: 0, delta_pct: 0 },
    ]);
    expect(rows.map((r) => [r.id, r.kind])).toEqual([
      ["apogee_m", "length"],
      ["landing_t", "time"],
    ]);
    expect(rows[0]).toMatchObject({ sim: 571.4, real: 459, delta: 112.4, deltaPct: 24.5 });
  });

  it("lists only the RMSE values the API could compute", () => {
    expect(rmseRows({ alt_m: 12.5, vz_ms: null, acc_ms2: 3 })).toEqual([
      { key: "alt_m", kind: "length", value: 12.5 },
      { key: "acc_ms2", kind: "acceleration", value: 3 },
    ]);
  });
});

describe("eventRows", () => {
  it("sorts in flight order and numbers repeated ids", () => {
    const rows = eventRows([
      { id: "landing", label: "Landing", sim_t: 148, real_t: 120, delta_t: 28 },
      { id: "deploy", label: "Deploy: Main", sim_t: 20, real_t: null, delta_t: null },
      { id: "apogee", label: "Apogee", sim_t: 11, real_t: 10, delta_t: 1 },
      { id: "deploy", label: "Deploy: Drogue", sim_t: 12, real_t: 17.5, delta_t: -5.5 },
    ]);
    expect(rows.map((r) => [r.id, r.ordinal])).toEqual([
      ["apogee", null],
      ["deploy", 1],
      ["deploy", 2],
      ["landing", null],
    ]);
  });
});

describe("formatting helpers", () => {
  it("signs deltas with a true minus", () => {
    expect(signed("12.3", 12.3)).toBe("+12.3");
    expect(signed("4.1", -4.1)).toBe("−4.1");
    expect(signed("-4.1", -4.1)).toBe("−4.1");
    expect(signed("0", 0)).toBe("0");
  });

  it("builds the picker text from what the flight has", () => {
    const flight: RealFlightSummary = {
      flight_id: "MT1-00279-9a1a6300",
      rocket: "MT1",
      launch_utc: "2026-10-18T10:12:00Z",
      stats: { apogee_m: 459 },
    };
    expect(flightOptionParts(flight, () => "18 Oct 2026", (m) => `${m} m`)).toEqual([
      "MT1",
      "MT1-00279-9a1a6300",
      "18 Oct 2026",
      "459 m",
    ]);
    expect(flightOptionParts({ flight_id: "x", stats: {} }, () => "", (m) => `${m}`)).toEqual(["x"]);
  });

  it("translates known warning codes only", () => {
    expect(warningKey("site_far")).toBe("realflight.warning.site_far");
    expect(warningKey("something_new")).toBeNull();
  });
});
