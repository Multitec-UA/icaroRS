/**
 * Typed client for the icaro API contract.
 *
 * Types come from two places (issue #51, extended by #70):
 *
 * 1. GENERATED — `lib/api/schema.d.ts` is produced by `openapi-typescript`
 *    from the committed OpenAPI snapshot (`openapi/schema.json`, refreshed
 *    via `npm run api:schema` + `npm run api:types` — see those scripts for
 *    the committed-snapshot-vs-live-API decision). `npm run api:check`
 *    fails CI if the committed types drift from a fresh generation. Every
 *    `apps/api` router endpoint now declares a real `response_model=`
 *    (issue #70), so `app.openapi()` sees field-level shape for all of them,
 *    not just `IdentityResponse` — e.g. `RocketSummary`, `RocketDetail`,
 *    `SimulationSummary`, `SimulateResult`, `ConvertResult`,
 *    `AtmosphereSuggestion`, and `FlightSeries` below are now imported
 *    straight from `components["schemas"]`, never hand-transcribed again.
 *
 * 2. HAND-WRITTEN — the `Scenario` domain-model family (`Site`, `LaunchDate`,
 *    `Atmosphere`, `Rail`, `Dispersion`, `Scenario`, `ScenarioTemplate`),
 *    `FieldError`, `ElevationResponse`, and `ResultEnvelope` stay hand-
 *    maintained even though real generated shapes exist for all of them now.
 *    Each has its own reason, noted on the type itself — mostly that the
 *    generated shape is a *narrower or differently-designed* type than the
 *    hand-written one (forward-compat status unions, deliberate nullability,
 *    a custom non-pydantic error shape), or that the type fans out across
 *    enough call sites (the whole wizard) that swapping it is worth its own
 *    reviewable PR rather than folding it into this schema-regen change.
 *
 * The `request` wrapper, `ApiError`, the stable `ErrorCode` union, and every
 * endpoint function are hand-written on purpose and are NOT meant to be
 * generated away — they carry request/response glue, retry-free error
 * mapping, and the i18n-facing error taxonomy that a generated client would
 * not produce.
 *
 * Auth: the API protects every route with an Identity Platform session
 * cookie (httpOnly — unreadable from JS). The browser signs in with the
 * Firebase client SDK (see lib/firebase.ts), then exchanges the resulting ID
 * token for that cookie via `createSession`. Every later request just needs
 * `credentials: "same-origin"` (the browser default) to send it — there is
 * no header for this layer to attach. All calls go through the Next rewrite
 * proxy (/api/* → API origin), so requests are same-origin and the cookie
 * stays scoped to the web origin (see apps/api routers/session.py).
 */

import type { components } from "./api/schema";

// ---------------------------------------------------------------------------
// Domain types — mirror packages/icaro/icaro/scenario.py
//
// A real generated shape exists for every one of these now (issue #70 gave
// `Scenario`, `Site`, `LaunchDate`, `Atmosphere`, `Rail`, `Dispersion`, and
// `ScenarioTemplate` field-level `response_model`s). They stay hand-written
// here on purpose, not because generation is impossible: this family feeds
// the entire scenario wizard (BasicsStep, WizardProvider, RocketStep, and
// friends), so swapping every one of these for its `components["schemas"]`
// equivalent is a call-site-heavy change worth its own small, reviewable PR
// rather than folding it into this schema-regen change. Left as a deliberate
// follow-up.
// ---------------------------------------------------------------------------

export type DispersionKind = "relative" | "absolute";

export interface Dispersion {
  std: number;
  kind: DispersionKind;
}

export interface Site {
  latitude: number;
  longitude: number;
  elevation: number | null;
}

export interface LaunchDate {
  year: number;
  month: number;
  day: number;
  hour: number;
}

export type AtmosphereModel =
  | "forecast"
  | "wyoming_sounding"
  | "standard_atmosphere"
  | "reanalysis";

export interface Atmosphere {
  model: AtmosphereModel;
  file: string | null;
  station: string | null;
  fallback: string;
}

export interface Rail {
  length: number | null;
  inclination: number | null;
  heading: number | null;
}

export interface Scenario {
  name: string;
  site: Site;
  date: LaunchDate | null;
  atmosphere: Atmosphere;
  rail: Rail | null;
  uncertainty: Record<string, Dispersion> | null;
}

// ---------------------------------------------------------------------------
// Endpoint response shapes
// ---------------------------------------------------------------------------

/**
 * GET /api/scenario/template — a starter Scenario plus the named presets.
 * Hand-written for the same reason as the `Scenario` family above (it
 * `extends Scenario`) — see that section's comment.
 */
export interface ScenarioTemplate extends Scenario {
  uncertainty_presets: Record<string, Record<string, Dispersion>>;
}

/**
 * One field-level validation error from POST /api/scenario/validate (422).
 *
 * NOT the same as the generated `components["schemas"]["ValidationError"]`
 * (FastAPI's generic pydantic-error shape, `{loc, msg, type, ...}`) — these
 * routes build a custom `{loc, field, message}` list by hand in the router
 * (see icaro_api/routers/scenario.py::_humanize_error) before raising
 * HTTPException, so it never round-trips through response_model either.
 */
export interface FieldError {
  loc: (string | number)[];
  field: string;
  message: string;
}

/** GET /api/atmosphere/suggest, from `response_model=AtmosphereSuggestion`. */
export type AtmosphereSuggestion = components["schemas"]["AtmosphereSuggestion"];

/**
 * GET /api/elevation. A real generated `ElevationLookupResult` shape exists
 * now (`{ elevation: number; source: "dem" }`, non-nullable — the router's
 * pydantic model has always guaranteed a non-null `elevation` on a 200, the
 * 503 failure path is a thrown `ApiError` instead). Kept hand-written with
 * the looser `elevation: number | null` because `BasicsStep.tsx` still has
 * an `elevation !== null` branch written for the pre-#70 untyped-dict world;
 * narrowing this type to match the generated one is correct but means
 * touching that call site's dead branch, which is a deliberate follow-up
 * left for a separate, smaller PR.
 */
export interface ElevationResponse {
  elevation: number | null;
  source: string;
}

/** POST /api/convert, from `response_model=ConvertResult`. */
export type ConvertResponse = components["schemas"]["ConvertResult"];

/** POST /api/simulate (and the `result` inside the results envelope). */
export type SimulateResult = components["schemas"]["SimulateResult"];

// ---------------------------------------------------------------------------
// Rockets + History endpoint shapes (simulation-persistence)
// ---------------------------------------------------------------------------

/**
 * One item from GET /api/rockets, from `response_model=list[RocketSummary]`.
 * This is the drift issue #70 fixes: the old hand-written shape was missing
 * `export_prefix`, `gcs_ref`, `ork_filename`, and `has_source_ork`, which the
 * router has returned for a while — the generated type now correctly
 * includes them.
 */
export type RocketSummary = components["schemas"]["RocketSummary"];

/**
 * Full rocket detail from GET /api/rockets/{rocket_id}, from
 * `response_model=RocketDetail`.
 */
export type RocketDetail = components["schemas"]["RocketDetail"];

/**
 * One item from GET /api/history, from `response_model=list[SimulationSummary]`.
 * Another drift issue #70 fixes: the old hand-written shape was missing
 * `warnings`, `result_prefix`, `plot_names`, and `has_series`.
 */
export type SimulationSummary = components["schemas"]["SimulationSummary"];

/**
 * GET /api/results/{run_id} — forward-compat job-status envelope.
 * The generated `ResultEnvelope` now exists but narrows `status` to the
 * literal `"done"` (the only value the router currently returns) — this
 * type deliberately keeps the wider `"running" | "error"` union for the
 * job-status polling this envelope is designed to support once the API
 * grows an in-progress/failed state, so it stays hand-written on purpose.
 */
export interface ResultEnvelope {
  run_id: string;
  status: "done" | "running" | "error";
  result: SimulateResult;
}

/**
 * GET /api/results/{run_id}/series — resampled flight time-series (issue #11),
 * from `response_model=FlightSeries`. All series share the `t` axis. A series
 * may be absent if it could not be extracted; `path3d` is (East, North, Up)
 * in metres, starting at the origin. 404 when the run predates this feature
 * → caller falls back to PNG plots.
 */
export type FlightSeries = components["schemas"]["FlightSeries"];

// ---------------------------------------------------------------------------
// Session — Identity Platform, via the httpOnly cookie minted by the API
//
// GENERATED — icaro_api/routers/session.py declares `response_model=
// IdentityResponse` (and a `SessionRequest` body model), so these round-trip
// through the OpenAPI schema with real field-level shape. This is exactly
// the drift the issue's motivating example hit in M1 (org_id + Identity
// hand-duplicated across languages) — it can't happen here anymore.
// ---------------------------------------------------------------------------

/** The caller's identity, as returned by GET /api/auth/me. */
export type Identity = components["schemas"]["IdentityResponse"];

/**
 * Exchange a freshly-minted Firebase ID token for our httpOnly session
 * cookie. Call right after a successful `signInWithPassword`.
 */
export function createSession(idToken: string): Promise<void> {
  const body: components["schemas"]["SessionRequest"] = { id_token: idToken };
  return request<void>("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Clear the session cookie. Always resolves, even if there was no session. */
export function logout(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

/**
 * The only way to check "am I signed in?" — the session cookie is httpOnly
 * and unreadable from JS. Throws ApiError(401) when there is no valid
 * session.
 */
export function getIdentity(): Promise<Identity> {
  return request<Identity>("/api/auth/me");
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Stable machine-readable error codes carried by ApiError.
 * The React layer maps these to catalog keys (errors.*) for localized display.
 * api.ts stays non-React — it never calls a hook.
 */
export type ErrorCode =
  | "network"
  | "validation"
  | "unavailable"
  | "requestFailed"
  | "imageFailed";

/**
 * Thrown for any non-2xx API response. Carries the HTTP status plus the parsed
 * body so callers can branch:
 *   401 → credentials missing/invalid → send the user back to the login screen
 *   422 → validation → `fieldErrors` holds per-field messages
 *   503 → a best-effort service is down → `hint` is the user-facing note
 *
 * `code` is a stable machine key; the React layer maps it to t("errors.<code>").
 * `message` is kept as an English fallback for logs and non-React callers.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fieldErrors?: FieldError[];
  readonly hint?: string;

  constructor(
    status: number,
    message: string,
    opts?: { code?: ErrorCode; fieldErrors?: FieldError[]; hint?: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = opts?.code ?? "requestFailed";
    this.fieldErrors = opts?.fieldErrors;
    this.hint = opts?.hint;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }
  get isValidation(): boolean {
    return this.status === 422;
  }
  get isUnavailable(): boolean {
    return this.status === 503;
  }
}

// ---------------------------------------------------------------------------
// Core fetch wrapper
// ---------------------------------------------------------------------------

/**
 * Parses a fetch `Response` into `T` or throws the mapped `ApiError` — the
 * exact same status → code mapping the client uses. Exported so
 * lib/server-api.ts (issue #52) can reuse it: Server Components can't use
 * `request()` below as-is (no browser cookie jar — the session cookie has to
 * be forwarded explicitly, and the fetch target is the API's real origin,
 * not the same-origin `/api/*` rewrite), but the response shape and error
 * mapping are identical either way.
 */
export async function parseApiResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    // 200 with no body (shouldn't happen on our contract) → undefined.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // Parse the error body; FastAPI puts the payload under `detail`.
  let detail: unknown;
  try {
    detail = (await res.json()).detail;
  } catch {
    detail = undefined;
  }

  if (res.status === 422 && Array.isArray(detail)) {
    throw new ApiError(422, "Some fields need attention.", {
      code: "validation",
      fieldErrors: detail as FieldError[],
    });
  }

  if (res.status === 503) {
    const hint =
      isRecord(detail) && typeof detail.hint === "string"
        ? detail.hint
        : isRecord(detail) && typeof detail.note === "string"
          ? detail.note
          : undefined;
    throw new ApiError(503, hint ?? "This service is temporarily unavailable.", {
      code: "unavailable",
      hint,
    });
  }

  const message =
    typeof detail === "string"
      ? detail
      : `Request failed (${res.status}).`;
  throw new ApiError(res.status, message, { code: "requestFailed" });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init });
  } catch {
    throw new ApiError(0, "Could not reach the icaro API. Is the server running?", {
      code: "network",
    });
  }
  return parseApiResponse<T>(res);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

// ---------------------------------------------------------------------------
// Endpoint functions
// ---------------------------------------------------------------------------

export function getScenarioTemplate(): Promise<ScenarioTemplate> {
  return request<ScenarioTemplate>("/api/scenario/template");
}

/** Validate/normalize a (possibly partial) scenario dict. Throws ApiError(422). */
export function validateScenario(body: unknown): Promise<Scenario> {
  return request<Scenario>("/api/scenario/validate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function suggestAtmosphere(dateIso: string): Promise<AtmosphereSuggestion> {
  const q = new URLSearchParams({ date: dateIso });
  return request<AtmosphereSuggestion>(`/api/atmosphere/suggest?${q}`);
}

/** Best-effort elevation lookup. Throws ApiError(503) when the DEM is down. */
export function getElevation(lat: number, lon: number): Promise<ElevationResponse> {
  const q = new URLSearchParams({ lat: String(lat), lon: String(lon) });
  return request<ElevationResponse>(`/api/elevation?${q}`);
}

export function convert(file: File): Promise<ConvertResponse> {
  const form = new FormData();
  form.append("file", file);
  return request<ConvertResponse>("/api/convert", { method: "POST", body: form });
}

export function simulate(
  exportId: string,
  scenario: unknown,
): Promise<SimulateResult> {
  const body: components["schemas"]["SimulateRequest"] = {
    export_id: exportId,
    scenario: scenario as Record<string, unknown>,
  };
  return request<SimulateResult>("/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function getResult(runId: string): Promise<ResultEnvelope> {
  return request<ResultEnvelope>(`/api/results/${encodeURIComponent(runId)}`);
}

/**
 * Fetch the interactive flight time-series for a run. Throws ApiError(404) for
 * runs that predate the feature — the caller should treat that as "no series"
 * and fall back to the static PNG plots.
 */
export function getSeries(runId: string): Promise<FlightSeries> {
  return request<FlightSeries>(`/api/results/${encodeURIComponent(runId)}/series`);
}

/**
 * Plot URLs in SimulateResult are already absolute paths under /api/results.
 * This helper exists for the rare case a caller needs to build one by hand.
 */
export function plotUrl(runId: string, name: string): string {
  return `/api/results/${encodeURIComponent(runId)}/plots/${encodeURIComponent(name)}.png`;
}

/** GET /api/rockets?limit=&before= — reverse-chronological list of saved rockets. */
export function getRockets(
  limit = 20,
  before?: string,
): Promise<RocketSummary[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set("before", before);
  return request<RocketSummary[]>(`/api/rockets?${q}`);
}

/** GET /api/rockets/{rocketId} — full rocket detail including manifest. */
export function getRocket(rocketId: string): Promise<RocketDetail> {
  return request<RocketDetail>(`/api/rockets/${encodeURIComponent(rocketId)}`);
}

/** GET /api/history?limit=&before= — reverse-chronological simulation history. */
export function getHistory(
  limit = 20,
  before?: string,
): Promise<SimulationSummary[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set("before", before);
  return request<SimulationSummary[]>(`/api/history?${q}`);
}
