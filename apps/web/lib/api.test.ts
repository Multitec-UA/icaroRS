import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  getElevation,
  getIdentity,
  logout,
  validateScenario,
} from "./api";

interface MockResponseInit {
  ok: boolean;
  status: number;
  json?: () => Promise<unknown>;
  text?: () => Promise<string>;
}

/** Stubs the global `fetch` used by lib/api.ts's `request()` wrapper. */
function mockFetchResolve(init: MockResponseInit) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    json: init.json ?? (() => Promise.resolve(undefined)),
    text: init.text ?? (() => Promise.resolve("")),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonOf(body: unknown) {
  return () => Promise.resolve(body);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ApiError status → code mapping", () => {
  it("maps a network failure (fetch rejects) to status 0 / code 'network'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const err: ApiError = await getIdentity().catch((e) => e);

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

  it("falls back to a generic message when the error body is not JSON", async () => {
    mockFetchResolve({
      ok: false,
      status: 500,
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
