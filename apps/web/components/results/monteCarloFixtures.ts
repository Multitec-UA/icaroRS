/** Monte Carlo runs as the API returns them, for tests (S12). */

import type { MonteCarloRun } from "@/lib/api";

export const MC_DONE: MonteCarloRun = {
  run_id: "mc-1",
  rocket_id: "rk-1",
  export_id: "exp-1",
  created_at: "2026-11-05T10:00:00Z",
  created_by: "pilot@multitec.dev",
  n: 100,
  status: "done",
  progress: { done: 100, total: 100 },
  queue_position: null,
  error: null,
  finished_at: "2026-11-05T10:01:00Z",
  result: {
    n_requested: 100,
    n_succeeded: 97,
    n_failed: 3,
    apogee_agl: [700, 750, 780, 790, 800, 810, 820, 860],
    apogee_stats: { mean: 793.3, std: 45.9, min: 700, max: 860, p5: 720, p50: 795, p95: 850 },
    impact_x: [],
    impact_y: [],
    ellipse_sigmas: [1, 2, 3],
    landing_ellipses: [
      [[38.1, -0.6], [38.1, -0.5], [38.2, -0.5]],
      [[38.0, -0.7], [38.0, -0.4], [38.3, -0.4]],
      [[37.9, -0.8], [37.9, -0.3], [38.4, -0.3]],
    ],
    apogee_ellipses: [],
    origin: { latitude: 38.2655, longitude: -0.6981 },
    files: { inputs: "mc.inputs.txt", outputs: "mc.outputs.txt", errors: "mc.errors.txt", kml: "mc.kml" },
  },
};

export function mcRun(overrides: Partial<MonteCarloRun>): MonteCarloRun {
  return { ...MC_DONE, status: "queued", progress: { done: 0, total: 100 }, result: null, finished_at: null, ...overrides };
}
