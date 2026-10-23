import { afterEach, describe, expect, it, vi } from "vitest";
import { RETRY_DELAYS_MS, describeFetchError, fetchRetrying } from "./fetch-retry";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function connectError(code: string, address: string): Error {
  return Object.assign(new Error(`connect ${code} ${address}:443`), { code, address, port: 443 });
}

describe("describeFetchError", () => {
  it("lists every attempt inside an AggregateError cause, with code and address", () => {
    const aggregate = new AggregateError(
      [connectError("ENETUNREACH", "2600:1900::"), connectError("ETIMEDOUT", "34.143.73.2")],
      "",
    );
    const err = new TypeError("fetch failed", { cause: aggregate });

    expect(describeFetchError(err)).toBe(
      "fetch failed: ENETUNREACH 2600:1900::; ETIMEDOUT 34.143.73.2",
    );
  });

  it("describes a single cause with its code", () => {
    const err = new TypeError("fetch failed", { cause: connectError("ECONNREFUSED", "127.0.0.1") });
    expect(describeFetchError(err)).toBe("fetch failed: ECONNREFUSED 127.0.0.1");
  });

  it("falls back to the message, or to String() for a non-Error", () => {
    expect(describeFetchError(new Error("offline"))).toBe("offline");
    expect(describeFetchError("boom")).toBe("boom");
  });
});

describe("fetchRetrying", () => {
  it("retries a rejected fetch with the given delays, then returns the response", async () => {
    vi.useFakeTimers();
    const ok = new Response("{}", { status: 200 });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(ok);
    vi.stubGlobal("fetch", fetchMock);
    const onRetry = vi.fn();

    const pending = fetchRetrying("/x", {}, { delaysMs: RETRY_DELAYS_MS, onRetry });
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBe(ok);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, "offline");
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, "offline");
  });

  it("rethrows the last error once the delays are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchRetrying("/x", {}, { delaysMs: [10] }).catch((e) => e);
    await vi.runAllTimersAsync();

    expect(await pending).toEqual(new Error("offline"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries a response the caller marks transient, and returns the last one", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 500 })));
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchRetrying("/x", {}, {
      delaysMs: [10, 20],
      isTransientResponse: (res) => res.status === 500,
    });
    await vi.runAllTimersAsync();

    expect((await pending).status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry at all with no delays", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchRetrying("/x", {}, { delaysMs: [] })).rejects.toThrow("offline");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
