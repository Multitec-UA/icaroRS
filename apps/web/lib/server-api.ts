/**
 * Server-only reads of the icaro API (issue #52).
 *
 * The client's `request()` in lib/api.ts relies on the browser's cookie jar
 * (`credentials: "same-origin"` is the default) and calls `/api/*`, which
 * `next.config.ts` rewrites to the API origin. Neither works from a Server
 * Component: there is no browser cookie jar on the server, and a relative
 * fetch URL has no origin to resolve against outside a browser. So this
 * module:
 *   1. Forwards the incoming request's cookies explicitly (the httpOnly
 *      `icaro_session` cookie among them — see apps/api's session.py).
 *   2. Calls the API's real origin directly (the same ICARO_API_ORIGIN
 *      next.config.ts's rewrite uses), instead of going through the rewrite.
 *
 * `cache: "no-store"` on every call: this is per-user authenticated data,
 * and it must never be shared across requests/users via Next's fetch cache.
 * Calling `cookies()` already opts the route into dynamic rendering for the
 * same reason.
 *
 * A connection that fails before reaching the API (typical right after a
 * new web instance starts) is retried with lib/fetch-retry.ts's backoff:
 * every call here is a GET, so repeating it is safe. Each retry and the
 * final failure are logged with the underlying connection errors, which
 * Node would otherwise print across many separate log entries.
 *
 * Only import this from Server Components — never from a "use client" file.
 * It shares response parsing (parseApiResponse) and the ApiError type with
 * lib/api.ts so error handling stays identical either way; it does NOT
 * import that module's `request()`, which is browser-only.
 */

import { cookies } from "next/headers";
import {
  ApiError,
  parseApiResponse,
  type ResultEnvelope,
  type RocketSummary,
  type SimulationSummary,
} from "./api";
import { RETRY_DELAYS_MS, describeFetchError, fetchRetrying } from "./fetch-retry";

const API_ORIGIN = process.env.ICARO_API_ORIGIN ?? "http://127.0.0.1:8000";

async function serverRequest<T>(path: string): Promise<T> {
  const cookieHeader = (await cookies()).toString();

  let res: Response;
  try {
    res = await fetchRetrying(
      `${API_ORIGIN}${path}`,
      {
        headers: cookieHeader ? { Cookie: cookieHeader } : undefined,
        cache: "no-store",
      },
      {
        delaysMs: RETRY_DELAYS_MS,
        onRetry: (retry, reason) => console.warn(`[server-api] GET ${path} retry ${retry}: ${reason}`),
      },
    );
  } catch (err) {
    console.error(`[server-api] GET ${path} failed: ${describeFetchError(err)}`);
    throw new ApiError(0, "Could not reach the icaro API. Is the server running?", {
      code: "network",
    });
  }
  return parseApiResponse<T>(res);
}

/** GET /api/rockets?limit=&before= — server-side counterpart to getRockets. */
export function getRocketsServer(limit = 20, before?: string): Promise<RocketSummary[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set("before", before);
  return serverRequest(`/api/rockets?${q}`);
}

/** GET /api/history?limit=&before= — server-side counterpart to getHistory. */
export function getHistoryServer(limit = 20, before?: string): Promise<SimulationSummary[]> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (before) q.set("before", before);
  return serverRequest(`/api/history?${q}`);
}

/** GET /api/results/{run_id} — server-side counterpart to getResult. */
export function getResultServer(runId: string): Promise<ResultEnvelope> {
  return serverRequest(`/api/results/${encodeURIComponent(runId)}`);
}
