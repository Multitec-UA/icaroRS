import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  createSession,
  getElevation,
  getIdentity,
  logout,
  simulate,
  validateScenario,
} from "./api";

interface MockResponseInit {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
  /** The API sends JSON unless told otherwise. */
  contentType?: string;
}

/** Stubs the global `fetch` used by lib/api.ts's `request()` wrapper with an API response. */
function mockFetchResolve(init: MockResponseInit) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    headers: new Headers({ "Content-Type": init.contentType ?? "application/json" }),
    json: init.json ?? (() => Promise.resolve(undefined)),
    text: init.text ?? (() => Promise.resolve("")),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * What Next's `/api/*` rewrite answers when it cannot reach the API at all:
 * a bare 500 with no Content-Type (verified against `next start` with the
 * API origin pointing at a closed port). Every API response, error or not,
 * carries a Content-Type.
 */
function proxyFailure() {
  const res = new Response("Internal Server Error", { status: 500 });
  // A string body makes Response add `Content-Type: text/plain` on its own;
  // Next's failure sends none.
  res.headers.delete("Content-Type");
  return res;
}

function jsonOf(body: unknown) {
  return () => Promise.resolve(body);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("ApiError status → code mapping", () => {
  it("maps a network failure (fetch rejects) to status 0 / code 'network'", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const pending = getIdentity().catch((e) => e);
    await vi.runAllTimersAsync();
    const err: ApiError = await pending;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe("network");
  });

  it("maps 401 to code 'requestFailed' with isUnauthorized true", async () => {
    mockFetchResolve({ ok: false, status: 401, json: jsonOf({ detail: "no session" }) });

    const err: ApiError = await getIdentity().catch((e) => e);

    expect(err.status).toBe(401);
    expect(err.code).toBe("requestFailed");
    expect(err.isUnauthorized).toBe(true);
    expect(err.isValidation).toBe(false);
    expect(err.isUnavailable).toBe(false);
    expect(err.message).toBe("no session");
  });

  it("maps 422 with a field-error array to code 'validation'", async () => {
    const fieldErrors = [{ loc: ["body", "name"], field: "name", message: "required" }];
    mockFetchResolve({ ok: false, status: 422, json: jsonOf({ detail: fieldErrors }) });

    const err: ApiError = await validateScenario({}).catch((e) => e);

    expect(err.status).toBe(422);
    expect(err.code).toBe("validation");
    expect(err.isValidation).toBe(true);
    expect(err.fieldErrors).toEqual(fieldErrors);
  });

  it("does not take the validation branch for a non-array 422 detail", async () => {
    mockFetchResolve({ ok: false, status: 422, json: jsonOf({ detail: "not an array" }) });

    const err: ApiError = await validateScenario({}).catch((e) => e);

    expect(err.code).toBe("requestFailed");
    expect(err.fieldErrors).toBeUndefined();
  });

  it("maps 503 to code 'unavailable', preferring detail.hint", async () => {
    mockFetchResolve({ ok: false, status: 503, json: jsonOf({ detail: { hint: "DEM is down" } }) });

    const err: ApiError = await getElevation(0, 0).catch((e) => e);

    expect(err.status).toBe(503);
    expect(err.code).toBe("unavailable");
    expect(err.isUnavailable).toBe(true);
    expect(err.hint).toBe("DEM is down");
    expect(err.message).toBe("DEM is down");
  });

  it("falls back to detail.note for a 503 without hint", async () => {
    mockFetchResolve({ ok: false, status: 503, json: jsonOf({ detail: { note: "try later" } }) });

    const err: ApiError = await getElevation(0, 0).catch((e) => e);

    expect(err.hint).toBe("try later");
    expect(err.message).toBe("try later");
  });

  it("uses a generic 503 message when neither hint nor note is present", async () => {
    mockFetchResolve({ ok: false, status: 503, json: jsonOf({ detail: {} }) });

    const err: ApiError = await getElevation(0, 0).catch((e) => e);

    expect(err.hint).toBeUndefined();
    expect(err.message).toBe("This service is temporarily unavailable.");
  });

  it("maps any other status to code 'requestFailed', using a string detail verbatim", async () => {
    mockFetchResolve({ ok: false, status: 400, json: jsonOf({ detail: "bad input" }) });

    const err: ApiError = await getIdentity().catch((e) => e);

    expect(err.status).toBe(400);
    expect(err.code).toBe("requestFailed");
    expect(err.message).toBe("bad input");
  });

  it("falls back to a generic message when the body has no string detail", async () => {
    mockFetchResolve({ ok: false, status: 500, json: jsonOf({}) });

    const err: ApiError = await getIdentity().catch((e) => e);

    expect(err.status).toBe(500);
    expect(err.code).toBe("requestFailed");
    expect(err.message).toBe("Request failed (500).");
  });

  it("maps a proxy failure that never reached the API to code 'network'", async () => {
    expect(proxyFailure().headers.get("Content-Type")).toBeNull();
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(proxyFailure())));

    const pending = getIdentity().catch((e) => e);
    await vi.runAllTimersAsync();
    const err: ApiError = await pending;

    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.code).toBe("network");
  });

  it("falls back to a generic message when the error body is not JSON", async () => {
    // FastAPI's own response to an unhandled exception: plain text, not JSON.
    mockFetchResolve({
      ok: false,
      status: 500,
      contentType: "text/plain; charset=utf-8",
      json: () => Promise.reject(new Error("not json")),
    });

    const err: ApiError = await getIdentity().catch((e) => e);

    expect(err.message).toBe("Request failed (500).");
  });
});

describe("successful responses", () => {
  it("parses a JSON body", async () => {
    mockFetchResolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ user_id: "u1", org_id: "o1", email: null })),
    });

    await expect(getIdentity()).resolves.toEqual({
      user_id: "u1",
      org_id: "o1",
      email: null,
    });
  });

  it("resolves to undefined for an empty 200 body", async () => {
    mockFetchResolve({ ok: true, status: 200, text: () => Promise.resolve("") });

    await expect(logout()).resolves.toBeUndefined();
  });
});

describe("retrying requests that never reached the API", () => {
  const identity = { user_id: "u1", org_id: "o1", email: null };
  const okJson = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

  it("retries a GET after a proxy failure and returns the later success", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(proxyFailure())
      .mockResolvedValueOnce(okJson(identity));
    vi.stubGlobal("fetch", fetchMock);

    const pending = getIdentity();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(identity);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a GET whose fetch rejects", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okJson(identity));
    vi.stubGlobal("fetch", fetchMock);

    const pending = getIdentity();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual(identity);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after three attempts in total", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(proxyFailure()));
    vi.stubGlobal("fetch", fetchMock);

    const pending = getIdentity().catch((e) => e);
    await vi.runAllTimersAsync();
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries the sign-in session exchange, which is safe to repeat", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(proxyFailure())
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = createSession("token");
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never retries a simulation, which must not run twice", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(proxyFailure()));
    vi.stubGlobal("fetch", fetchMock);

    const err: ApiError = await simulate("export-1", {}).catch((e) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.code).toBe("network");
  });

  it("does not retry a real API error, even a 500", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ detail: "boom" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const err: ApiError = await getIdentity().catch((e) => e);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(err.code).toBe("requestFailed");
    expect(err.message).toBe("boom");
  });
});
