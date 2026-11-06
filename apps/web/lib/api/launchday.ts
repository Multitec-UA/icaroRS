/**
 * POST /api/launchday types (launch-day S5), aliased from the generated
 * OpenAPI types (`lib/api/schema.d.ts`) under the names the components use.
 */

import type { components } from "./schema";

type Schemas = components["schemas"];

/** Manual wind measured on the pad, as the scenario body carries it (m/s, degrees FROM). */
export type ScenarioWind = Schemas["Wind"];

export type LaunchDayRequest = Schemas["LaunchDayRequest"];

/** One rail setting, flown once. Metres, m/s, degrees, calibres. */
export type LaunchCandidate = Schemas["RailCandidateModel"];

/** The check ids `icaro.launchday.launch_checks` emits (S4); the schema types them as `string`. */
export type LaunchCheckId =
  | "apogee_max"
  | "apogee_recommended"
  | "tilt_max"
  | "static_margin_min"
  | "descent_max"
  | "descent_recommended"
  | "landing_radius"
  | "rail_exit_min"
  | "wind_max";

/** One L1 check. `limit` is a number, or `[low, high]` with `comparator: "between"`. */
export type LaunchCheck = Omit<Schemas["LaunchCheckModel"], "id"> & { id: LaunchCheckId };

/** The wind the sweep used: m/s, degrees FROM, measured or the model's. */
export type LaunchDayWind = Schemas["WindUsedModel"];

export type LaunchLimits = Schemas["LaunchLimitsModel"];

export type LaunchDayResult = Omit<Schemas["LaunchDayResponse"], "checks_current" | "checks_best"> & {
  checks_current: LaunchCheck[];
  checks_best: LaunchCheck[] | null;
};
