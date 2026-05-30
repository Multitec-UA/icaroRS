/**
 * Typed client for the frozen icaro API contract (Phase 1).
 *
 * Every type here is derived 1:1 from the Phase 1 response shapes
 * (apps/api/icaro_api/routers/*.py + the icaro Scenario domain model).
 * Phase 2 is presentation only — it does NOT add or change endpoints.
 *
 * Auth: the API protects every route with HTTP Basic. The browser SPA holds
 * the credentials in sessionStorage (set via a login screen) and attaches an
 * `Authorization: Basic` header to every request. All calls go through the
 * Next rewrite proxy (/api/* → API origin), so requests are same-origin.
 */

// ---------------------------------------------------------------------------
// Domain types — mirror packages/icaro/icaro/scenario.py
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

/** GET /api/scenario/template — a starter Scenario plus the named presets. */
export interface ScenarioTemplate extends Scenario {
  uncertainty_presets: Record<string, Record<string, Dispersion>>;
}

/** One field-level validation error from POST /api/scenario/validate (422). */
export interface FieldError {
  loc: (string | number)[];
  field: string;
  message: string;
}

/** GET /api/atmosphere/suggest */
export interface AtmosphereSuggestion {
  model: AtmosphereModel;
  reason: string;
  within_gfs_window: boolean;
  needs_internet: boolean;
}

/** GET /api/elevation */
export interface ElevationResponse {
  elevation: number | null;
  source: string;
}

/** POST /api/convert */
export interface ConvertResponse {
  export_id: string;
  manifest: Record<string, unknown>;
}

/** POST /api/simulate (and the `result` inside the results envelope). */
export interface SimulateResult {
  run_id: string;
  scalars: Record<string, number | null>;
  plot_urls: string[];
  warnings: string[];
}

/** GET /api/results/{run_id} — forward-compat job-status envelope. */
export interface ResultEnvelope {
  run_id: string;
  status: "done" | "running" | "error";
  result: SimulateResult;
}

/**
 * GET /api/results/{run_id}/series — resampled flight time-series (issue #11).
 * All series share the `t` axis. A series may be absent if it could not be
 * extracted; `path3d` is (East, North, Up) in metres, starting at the origin.
 * 404 when the run predates this feature → caller falls back to PNG plots.
 */
export interface FlightSeries {
  t: number[];
  altitude?: number[];
  speed?: number[];
  mach?: number[];
  acceleration?: number[];
  path3d?: [number, number, number][];
}

// ---------------------------------------------------------------------------
// Credentials store (HTTP Basic) — sessionStorage, client-only
// ---------------------------------------------------------------------------

const CREDS_KEY = "icaro.basic";

/** Store base64(user:pass) for the session. Call from the login screen. */
export function setCredentials(user: string, pass: string): void {
  const token = btoa(`${user}:${pass}`);
  sessionStorage.setItem(CREDS_KEY, token);
}

export function clearCredentials(): void {
  sessionStorage.removeItem(CREDS_KEY);
}

export function hasCredentials(): boolean {
  return typeof window !== "undefined" && !!sessionStorage.getItem(CREDS_KEY);
}

function authHeader(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = sessionStorage.getItem(CREDS_KEY);
  return token ? { Authorization: `Basic ${token}` } : {};
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/**
 * Thrown for any non-2xx API response. Carries the HTTP status plus the parsed
 * body so callers can branch:
 *   401 → credentials missing/invalid → send the user back to the login screen
 *   422 → validation → `fieldErrors` holds per-field messages
 *   503 → a best-effort service is down → `hint` is the user-facing note
 */
export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors?: FieldError[];
  readonly hint?: string;

  constructor(
    status: number,
    message: string,
    opts?: { fieldErrors?: FieldError[]; hint?: string },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(authHeader())) headers.set(k, v);

  let res: Response;
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Could not reach the icaro API. Is the server running?");
  }

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
      fieldErrors: detail as FieldError[],
    });
  }

  if (res.status === 503) {
    const hint =
      isRecord(detail) && typeof detail.hint === "string"
        ? detail.hint
        : isRecord(detail) && typeof detail.note === "string"
          ? detail.note
          : "This service is temporarily unavailable.";
    throw new ApiError(503, hint, { hint });
  }

  const message =
    typeof detail === "string"
      ? detail
      : `Request failed (${res.status}).`;
  throw new ApiError(res.status, message);
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
  return request<SimulateResult>("/api/simulate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ export_id: exportId, scenario }),
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

/**
 * Fetch an authenticated binary asset (e.g. a plot PNG) and return an object
 * URL. A plain `<img src>` cannot carry our sessionStorage Basic header, so
 * plots — which sit behind auth — must be fetched this way. Callers MUST
 * `URL.revokeObjectURL` the result when the image unmounts.
 */
export async function fetchImageObjectUrl(path: string): Promise<string> {
  const headers = new Headers(authHeader());
  let res: Response;
  try {
    res = await fetch(path, { headers });
  } catch {
    throw new ApiError(0, "Could not reach the icaro API.");
  }
  if (!res.ok) throw new ApiError(res.status, `Failed to load image (${res.status}).`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}
