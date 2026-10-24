/**
 * Shared fixtures for the flight component tests. One realistic scalar set
 * (the keys `GET /api/simulate` returns) and a short series whose numbers
 * are easy to read back in assertions: 3 s of flight, apogee 300 m at t=2,
 * ground track 5 m per sample.
 */

import type { FlightSeries } from "@/lib/api";

export const SCALARS: Record<string, number> = {
  apogee_m: 3142.2,
  apogee_time_s: 21.8,
  apogee_x_m: 120,
  apogee_y_m: 40,
  flight_time_s: 142,
  impact_velocity_ms: 8.4,
  impact_x_m: 1200,
  impact_y_m: 900,
  max_acceleration_ms2: 95.3,
  max_acceleration_time_s: 0.9,
  max_mach: 0.84,
  max_velocity_ms: 287.4,
  max_velocity_time_s: 3.1,
  rail_departure_stability_margin: 1.93,
  rail_departure_time_s: 0.41,
  rail_departure_velocity_ms: 27.3,
};

export const SERIES: FlightSeries = {
  t: [0, 1, 2, 3],
  altitude: [0, 100, 300, 200],
  speed: [0, 50, 30, 10],
  mach: [0, 0.2, 0.1, 0],
  acceleration: [80, 20, -9.8, -9.8],
  path3d: [
    [0, 0, 0],
    [3, 4, 100],
    [6, 8, 300],
    [9, 12, 200],
  ],
};
