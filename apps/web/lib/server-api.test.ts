import { afterEach, describe, expect, it, vi } from "vitest";

const { cookiesMock } = vi.hoisted(() => ({ cookiesMock: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
}));

function mockCookieJar(toString: string) {
  cookiesMock.mockResolvedValue({ toString: () => toString });
}

function mockFetchResolve(init: { ok: boolean; status: number; body?: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok,
    status: init.status,
    text: () => Promise.resolve(init.body === undefined ? "" : JSON.stringify(init.body)),
    json: () => Promise.resolve({ detail: init.body }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
  cookiesMock.mockReset();
});

describe("server-api — cookie forwarding", () => {
  it("forwards the request's cookies as a Cookie header", async () => {
    mockCookieJar("icaro_session=abc123; NEXT_LOCALE=es");
    const fetchMock = mockFetchResolve({ ok: true, status: 200, body: [] });

    const { getRocketsServer } = await import("./server-api");
    await getRocketsServer();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/rockets?"),
      expect.objectContaining({
        headers: { Cookie: "icaro_session=abc123; NEXT_LOCALE=es" },
        cache: "no-store",
      }),
    );
  });

  it("omits the Cookie header entirely when there are no cookies", async () => {
    mockCookieJar("");
    const fetchMock = mockFetchResolve({ ok: true, status: 200, body: [] });

    const { getHistoryServer } = await import("./server-api");
    await getHistoryServer();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: undefined }),
    );
  });
});

describe("server-api — response handling (reuses lib/api.ts's parseApiResponse)", () => {
  it("returns parsed data on success", async () => {
    mockCookieJar("");
    mockFetchResolve({
      ok: true,
      status: 200,
      body: { run_id: "run-1", status: "done", result: { run_id: "run-1", scalars: {}, plot_urls: [], warnings: [] } },
    });

    const { getResultServer } = await import("./server-api");
    await expect(getResultServer("run-1")).resolves.toMatchObject({ run_id: "run-1" });
  });

  it("maps a fetch rejection to ApiError(0, code: network)", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockCookieJar("");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const { getRocketsServer } = await import("./server-api");
    const { ApiError } = await import("./api");

    const pending = getRocketsServer().catch((e) => e);
    await vi.runAllTimersAsync();
    const err: InstanceType<typeof ApiError> = await pending;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.code).toBe("network");
  });
});

describe("server-api — connections that never reached the API", () => {
  it("retries a failed connection and returns the later success", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockCookieJar("");
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: () => Promise.resolve(JSON.stringify([])),
      });
    vi.stubGlobal("fetch", fetchMock);

    const { getHistoryServer } = await import("./server-api");
    const pending = getHistoryServer();
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("[server-api] GET /api/history?limit=20 retry 1: fetch failed");
  });

  it("logs the cause once it gives up, after three attempts", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    mockCookieJar("");
    const cause = Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT", address: "34.143.73.2" });
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
    vi.stubGlobal("fetch", fetchMock);

    const { getHistoryServer } = await import("./server-api");
    const pending = getHistoryServer().catch((e) => e);
    await vi.runAllTimersAsync();
    await pending;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(errorLog).toHaveBeenCalledWith(
      "[server-api] GET /api/history?limit=20 failed: fetch failed: ETIMEDOUT 34.143.73.2",
    );
  });
});
