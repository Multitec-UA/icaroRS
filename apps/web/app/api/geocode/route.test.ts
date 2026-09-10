import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The route module keeps its cache and rate-limit queue as module-level
 * state (see route.ts). Re-importing fresh per test (vi.resetModules) keeps
 * tests independent instead of leaking state — and cheaply sidesteps the
 * ~1.1s shared-rate-limit wait that would otherwise accumulate across tests
 * sharing one module instance.
 */
async function freshRoute() {
  vi.resetModules();
  return import("./route");
}

function geocodeRequest(q: string): NextRequest {
  return new NextRequest(`http://localhost/api/geocode?q=${encodeURIComponent(q)}`);
}

describe("GET /api/geocode (issue #55)", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves with no hits and never calls Nominatim below the minimum query length", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await freshRoute();

    const res = await GET(geocodeRequest("al"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ hits: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("proxies a successful lookup and identifies the app with a real User-Agent", async () => {
    const hits = [{ lat: "38.34", lon: "-0.48", display_name: "Alicante, Spain" }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(hits), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await freshRoute();

    const res = await GET(geocodeRequest("Alicante"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ hits });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("nominatim.openstreetmap.org/search");
    expect(url).toContain("q=Alicante");
    const headers = init.headers as Record<string, string>;
    // A real, non-empty User-Agent — the entire point of #55: this is
    // unsetteable from the browser (forbidden header name), so it must be
    // set from the server.
    expect(headers["User-Agent"]).toMatch(/icaroRS/i);
  });

  it("distinguishes a network failure from a genuine empty result", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await freshRoute();

    const res = await GET(geocodeRequest("Nowhereville"));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "network" });
  });

  it("surfaces a 429 throttle from Nominatim distinctly from other failures", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await freshRoute();

    const res = await GET(geocodeRequest("Toolong"));
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body).toEqual({ error: "rateLimited" });
  });

  it("maps any other non-ok upstream response to a generic upstream error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await freshRoute();

    const res = await GET(geocodeRequest("Somewhere500"));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body).toEqual({ error: "upstream" });
  });

  it("serves a repeated (normalized) query from cache without a second upstream call", async () => {
    const hits = [{ lat: "1", lon: "2", display_name: "Cached place" }];
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(hits), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { GET } = await freshRoute();

    const first = await GET(geocodeRequest("Repeatquery"));
    const second = await GET(geocodeRequest("  REPEATQUERY  "));

    expect(await first.json()).toEqual({ hits });
    expect(await second.json()).toEqual({ hits });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
