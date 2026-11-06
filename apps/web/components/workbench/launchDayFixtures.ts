/** A /api/launchday response for tests (launch-day S5 contract). */

import type { LaunchCandidate, LaunchDayResult } from "@/lib/api/launchday";

export function candidate(inclination: number, heading: number, distance: number, checksOk = true): LaunchCandidate {
  return {
    inclination,
    heading,
    apogee_agl: 540,
    landing_distance: distance,
    landing_bearing: 44,
    out_of_rail_velocity: 22.1,
    stability_margin_min: 1.8,
    impact_velocity: 5.6,
    checks_ok: checksOk,
  };
}

export const CANDIDATES = [
  candidate(86, 240, 123.4),
  ...Array.from({ length: 9 }, (_, i) => candidate(90 - (i % 6) * 2, i * 30, 150 + i * 20, i !== 2)),
];

export const SWEEP: LaunchDayResult = {
  wind: { speed: 5, direction_from: 270, source: "manual" },
  current: candidate(85, 90, 310),
  best: CANDIDATES[0],
  candidates: CANDIDATES,
  skipped: [{ inclination: 80, heading: 330, error: "boom" }],
  checks_current: [
    { id: "apogee_max", value: 560, limit: 1000, comparator: "<=", ok: true, severity: "hard", source: "PROP-003" },
    { id: "landing_radius", value: 610, limit: 500, comparator: "<=", ok: false, severity: "soft", source: "REC-003" },
  ],
  checks_best: [
    { id: "apogee_max", value: 540, limit: 1000, comparator: "<=", ok: true, severity: "hard", source: "PROP-003" },
    { id: "landing_radius", value: 123.4, limit: 500, comparator: "<=", ok: true, severity: "soft", source: "REC-003" },
  ],
  limits: {
    apogee_max_m: 1000,
    apogee_recommended_max_m: 600,
    tilt_max_deg: 20,
    static_margin_min_cal: 1.5,
    descent_max_ms: 10,
    descent_recommended_ms: [5, 6],
    landing_radius_m: 500,
    rail_exit_min_ms: 15,
    wind_max_kmh: 32,
  },
};

