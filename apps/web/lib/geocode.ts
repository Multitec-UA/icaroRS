/**
 * Client for our own `/api/geocode` route handler (issue #55).
 *
 * Deliberately separate from lib/api.ts: geocoding is not part of the icaro
 * API contract (it never reaches apps/api — see app/api/geocode/route.ts),
 * so it has no business sharing that module's generated types or its
 * request()/ApiError machinery, which is scoped to the FastAPI backend.
 */

export interface GeocodeHit {
  lat: string;
  lon: string;
  display_name: string;
}

export type GeocodeErrorCode = "network" | "rateLimited" | "upstream";

/**
 * Thrown when the geocode route itself could not be reached, or it reported
 * that the upstream lookup failed. NOT thrown for a genuine zero-result
 * search — that resolves with an empty array, same as before.
 */
export class GeocodeError extends Error {
  readonly code: GeocodeErrorCode;

  constructor(code: GeocodeErrorCode) {
    super(`Geocoding failed (${code}).`);
    this.name = "GeocodeError";
    this.code = code;
  }
}

/**
 * Look up a place by free-text query through our server-side proxy.
 * Resolves to `[]` for a genuine "no matches" result; throws `GeocodeError`
 * when the lookup itself could not be completed (network failure, upstream
 * error, or a 429 throttle) so the caller can render that distinctly from
 * an empty result set.
 */
export async function geocodeSearch(query: string): Promise<GeocodeHit[]> {
  let res: Response;
  try {
    res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new GeocodeError("network");
  }

  if (!res.ok) {
    let code: GeocodeErrorCode = "upstream";
    try {
      const body = await res.json();
      if (body?.error === "rateLimited" || body?.error === "network" || body?.error === "upstream") {
        code = body.error;
      }
    } catch {
      // Fall through with the default "upstream" code.
    }
    throw new GeocodeError(code);
  }

  const body = (await res.json()) as { hits: GeocodeHit[] };
  return body.hits;
}
