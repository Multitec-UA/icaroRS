/**
 * Server-side proxy for OpenStreetMap Nominatim place search (issue #55).
 *
 * `components/map/SitePicker.tsx` used to call Nominatim directly from the
 * browser. That cannot satisfy Nominatim's usage policy: it requires a
 * genuine identifying `User-Agent`, but `User-Agent` is a forbidden header
 * name — `fetch` silently refuses to set it from a browser context. Proxying
 * through this route handler lets us:
 *   1. Identify the application with a real `User-Agent`, per policy.
 *   2. Enforce a single shared rate limit (~1 req/s, per the policy's
 *      guidance) across every browser tab and every user of this server
 *      instance, instead of each tab debouncing independently.
 *   3. Cache repeated lookups for a short time so retyping/backspacing
 *      doesn't refetch identical queries.
 *   4. Return a response shape that distinguishes "the upstream call
 *      failed" from "zero results" — the browser's `catch { setHits([]) }`
 *      made those indistinguishable.
 *
 * Routing note: this file lives under `app/api/*`, which
 * `next.config.ts`'s `rewrites()` also proxies (as a plain array, i.e.
 * Next's "afterFiles" semantics) to the FastAPI origin. That is NOT a
 * conflict: Next's documented route order checks the filesystem (route
 * handlers included, for non-dynamic routes) BEFORE applying afterFiles
 * rewrites — rewrites only apply to paths nothing in the filesystem
 * matched. Verified empirically against next@16.2.6 with `next dev`: a
 * request to `/api/geocode` is served by this handler, never forwarded to
 * `ICARO_API_ORIGIN`. See the PR description for the verification steps.
 *
 * Caveats acknowledged and accepted for this scope:
 *   - The rate limiter and cache are in-memory and per server process. A
 *     multi-instance deployment (e.g. several Cloud Run instances) would
 *     get one independent limiter per instance rather than one global
 *     limiter — still a large improvement over "no coordination at all",
 *     and consistent with this app's other in-process state.
 *   - The cache has no persistence across restarts/deploys; that's fine,
 *     it exists to smooth out retyping within a session, not as a durable
 *     store.
 */

import type { NextRequest } from "next/server";

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
}

type GeocodeErrorCode = "network" | "rateLimited" | "upstream";

const NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search";

// Nominatim's usage policy: identify the application with a real UA/Referer.
// See https://operations.osmfoundation.org/policies/nominatim/
const USER_AGENT = "icaroRS/1.0 (rocket-simulation app; https://github.com/Multitec-UA/icaroRS)";

const MIN_QUERY_LENGTH = 3;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — long enough to smooth retyping
const MAX_CACHE_ENTRIES = 200;
// Policy guidance is "no more than 1 request per second" — pad slightly so
// clock jitter never puts us over it.
const MIN_INTERVAL_MS = 1100;

// ---------------------------------------------------------------------------
// Short-lived cache, keyed on the normalized query. Module-level state is
// intentional: it is shared across every request this server process
// handles for as long as the process lives (see the caveats above).
// ---------------------------------------------------------------------------

interface CacheEntry {
  expiresAt: number;
  hits: NominatimHit[];
}

const cache = new Map<string, CacheEntry>();

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ");
}

function readCache(key: string): NominatimHit[] | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.hits;
}

function writeCache(key: string, hits: NominatimHit[]): void {
  if (cache.size >= MAX_CACHE_ENTRIES) {
    // Cheap unbounded-growth guard: evict the oldest entry (Map preserves
    // insertion order). This is a smoothing cache, not a correctness-critical
    // one, so FIFO eviction is good enough.
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) cache.delete(oldestKey);
  }
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, hits });
}

// ---------------------------------------------------------------------------
// Shared rate limiter — a serialized queue, not a per-request timer, so
// concurrent requests from different users still queue behind one another
// instead of racing past the limit.
// ---------------------------------------------------------------------------

let lastRequestAt = 0;
let requestQueue: Promise<void> = Promise.resolve();

function scheduleUpstreamCall(): Promise<void> {
  const turn = requestQueue.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
  });
  // Keep the queue alive even if this turn's caller later throws.
  requestQueue = turn.catch(() => {});
  return turn;
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

function errorResponse(status: number, code: GeocodeErrorCode) {
  return Response.json({ error: code }, { status });
}

export async function GET(request: NextRequest) {
  const rawQuery = request.nextUrl.searchParams.get("q") ?? "";
  const query = rawQuery.trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return Response.json({ hits: [] satisfies NominatimHit[] });
  }

  const cacheKey = normalizeQuery(query);
  const cached = readCache(cacheKey);
  if (cached) {
    return Response.json({ hits: cached });
  }

  await scheduleUpstreamCall();

  const url = `${NOMINATIM_SEARCH_URL}?format=json&limit=5&q=${encodeURIComponent(query)}`;
  let upstream: Response;
  try {
    upstream = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
    });
  } catch {
    return errorResponse(502, "network");
  }

  if (upstream.status === 429) {
    return errorResponse(429, "rateLimited");
  }
  if (!upstream.ok) {
    return errorResponse(502, "upstream");
  }

  let hits: NominatimHit[];
  try {
    hits = await upstream.json();
  } catch {
    return errorResponse(502, "upstream");
  }

  writeCache(cacheKey, hits);
  return Response.json({ hits });
}
