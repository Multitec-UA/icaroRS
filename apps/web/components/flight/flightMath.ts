/**
 * Pure helpers behind the flight components (S9): time ↔ path progress,
 * interpolated readouts, the ground track, the landing distance, the
 * timeline events and the number formatting every card shares. No React,
 * no DOM — the components stay thin and these stay unit-testable.
 */

import type { Locale } from "@/lib/i18n";

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Map a simulated time onto the trajectory's progress ∈ [0,1] — a fractional
 * index over `times` divided by the last index, so the 3D marker (which
 * samples its polyline by index) sits where the rocket was at that second
 * even when the samples are not evenly spaced. Times are assumed ascending.
 */
export function timeToProgress(times: number[], time: number): number {
  const n = times.length;
  if (n < 2) return 0;
  const last = times[n - 1];
  if (!(time > times[0])) return 0;
  if (time >= last) return 1;
  const i = upperIndex(times, time);
  const t0 = times[i - 1];
  const t1 = times[i];
  const frac = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
  return (i - 1 + frac) / (n - 1);
}

/** First index whose time is strictly greater than `time` (binary search). */
function upperIndex(times: number[], time: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= time) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of `values` at `time`; null when the series is unusable. */
export function sampleAt(
  times: number[],
  values: number[] | null | undefined,
  time: number,
): number | null {
  if (!values || values.length === 0 || times.length === 0) return null;
  const n = Math.min(times.length, values.length);
  if (time <= times[0]) return finiteOrNull(values[0]);
  if (time >= times[n - 1]) return finiteOrNull(values[n - 1]);
  const i = upperIndex(times.slice(0, n), time);
  const t0 = times[i - 1];
  const t1 = times[i];
  const v0 = values[i - 1];
  const v1 = values[i];
  if (!isFiniteNumber(v0) || !isFiniteNumber(v1)) return null;
  const frac = t1 > t0 ? (time - t0) / (t1 - t0) : 0;
  return v0 + (v1 - v0) * frac;
}

function finiteOrNull(value: number | undefined): number | null {
  return isFiniteNumber(value) ? value : null;
}

/** Horizontal distance from the pad for every (East, North, Up) sample. */
export function groundTrack(path3d: number[][] | null | undefined): number[] {
  if (!path3d) return [];
  return path3d.map(([east, north]) => Math.hypot(east ?? 0, north ?? 0));
}

/** Landing distance from the pad, √(x² + y²); null unless both offsets are numbers. */
export function landingDistance(
  impactEast: number | null | undefined,
  impactNorth: number | null | undefined,
): number | null {
  if (!isFiniteNumber(impactEast) || !isFiniteNumber(impactNorth)) return null;
  return Math.hypot(impactEast, impactNorth);
}

// ---------------------------------------------------------------------------
// Timeline events
// ---------------------------------------------------------------------------

export type FlightEventKey = "rail" | "maxAcceleration" | "maxSpeed" | "apogee" | "landing";

export interface FlightEvent {
  key: FlightEventKey;
  /** i18n key of the row label (`flight.event*`). */
  labelKey: string;
  /** Simulated time of the event, seconds. Always finite. */
  time: number;
  /** The event's headline quantity, when the scalar is present. */
  value: { amount: number; unit: string } | null;
}

const EVENT_SPECS: {
  key: FlightEventKey;
  labelKey: string;
  timeKey: string;
  valueKey: string;
  unit: string;
}[] = [
  {
    key: "rail",
    labelKey: "flight.eventRail",
    timeKey: "rail_departure_time_s",
    valueKey: "rail_departure_velocity_ms",
    unit: "m/s",
  },
  {
    key: "maxAcceleration",
    labelKey: "flight.eventMaxAcceleration",
    timeKey: "max_acceleration_time_s",
    valueKey: "max_acceleration_ms2",
    unit: "m/s²",
  },
  {
    key: "maxSpeed",
    labelKey: "flight.eventMaxSpeed",
    timeKey: "max_velocity_time_s",
    valueKey: "max_velocity_ms",
    unit: "m/s",
  },
  { key: "apogee", labelKey: "flight.eventApogee", timeKey: "apogee_time_s", valueKey: "apogee_m", unit: "m" },
  {
    key: "landing",
    labelKey: "flight.eventLanding",
    timeKey: "flight_time_s",
    valueKey: "impact_velocity_ms",
    unit: "m/s",
  },
];

/**
 * The flight's events, in time order. Only events whose time is a finite
 * number are included — a missing scalar never invents an event.
 */
export function flightEvents(scalars: Record<string, number | null | undefined>): FlightEvent[] {
  const events: FlightEvent[] = [];
  for (const spec of EVENT_SPECS) {
    const time = scalars[spec.timeKey];
    if (!isFiniteNumber(time)) continue;
    const amount = scalars[spec.valueKey];
    events.push({
      key: spec.key,
      labelKey: spec.labelKey,
      time,
      value: isFiniteNumber(amount) ? { amount, unit: spec.unit } : null,
    });
  }
  return events.sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Decimals that keep a readout honest without noise: 3,142 · 27.3 · 1.93. */
export function fractionDigitsFor(value: number): number {
  const abs = Math.abs(value);
  return abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
}

export function formatNumber(value: number, locale: Locale, maximumFractionDigits?: number): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: maximumFractionDigits ?? fractionDigitsFor(value),
  }).format(value);
}

/** `3,142 m` with a non-breaking space before the unit; just the number when unitless. */
export function formatQuantity(value: number, unit: string, locale: Locale): string {
  const num = formatNumber(value, locale);
  return unit ? `${num} ${unit}` : num;
}

/** Seconds readout for timelines and captions. */
export function formatSeconds(value: number, locale: Locale): string {
  return formatQuantity(value, "s", locale);
}

/** Metres under a kilometre, kilometres past it (`500 m`, `1.5 km`). */
export function splitDistance(metres: number): { amount: number; unit: string } {
  return metres >= 1000 ? { amount: metres / 1000, unit: "km" } : { amount: metres, unit: "m" };
}
