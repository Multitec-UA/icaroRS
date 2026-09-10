import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { getQueryClient, setUnauthorizedHandler } from "./query-client";

afterEach(() => {
  setUnauthorizedHandler(null);
});

describe("getQueryClient", () => {
  it("returns a fresh client when there is no window (server rendering)", () => {
    const originalWindow = globalThis.window;
    // @ts-expect-error — simulate a server environment for this assertion only.
    delete globalThis.window;
    try {
      expect(getQueryClient()).not.toBe(getQueryClient());
    } finally {
      globalThis.window = originalWindow;
    }
  });

  it("returns the same client on every call in the browser", () => {
    expect(getQueryClient()).toBe(getQueryClient());
  });
});

describe("centralized 401 handling", () => {
  it("calls the registered handler when a query fails with an unauthorized ApiError", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const client = getQueryClient();

    await client
      .fetchQuery({
        queryKey: ["unauthorized-probe"],
        queryFn: () => Promise.reject(new ApiError(401, "no session", { code: "requestFailed" })),
      })
      .catch(() => undefined);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not call the handler for a non-401 error", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const client = getQueryClient();

    await client
      .fetchQuery({
        queryKey: ["not-unauthorized-probe"],
        queryFn: () => Promise.reject(new ApiError(500, "boom", { code: "requestFailed" })),
      })
      .catch(() => undefined);

    expect(handler).not.toHaveBeenCalled();
  });

  it("does not throw when no handler is registered", async () => {
    setUnauthorizedHandler(null);
    const client = getQueryClient();

    await expect(
      client
        .fetchQuery({
          queryKey: ["no-handler-probe"],
          queryFn: () => Promise.reject(new ApiError(401, "no session", { code: "requestFailed" })),
        })
        .catch(() => undefined),
    ).resolves.toBeUndefined();
  });
});
