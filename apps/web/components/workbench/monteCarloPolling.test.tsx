import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import { useMonteCarloQuery } from "@/lib/queries";
import { MC_DONE, mcRun } from "@/components/results/monteCarloFixtures";

/** S12 — the status query polls every ~2 s while queued/running and stops once done or failed. */

const getMonteCarlo = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getMonteCarlo: (...args: unknown[]) => getMonteCarlo(...args),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Advance the fake clock and let React render what the query delivered. */
async function tick(ms: number) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
}

afterEach(() => {
  getMonteCarlo.mockReset();
  vi.useRealTimers();
});

describe("useMonteCarloQuery polling (S12)", () => {
  it("polls while queued and running, then stops on done", async () => {
    vi.useFakeTimers();
    getMonteCarlo
      .mockResolvedValueOnce(mcRun({ status: "queued", queue_position: 1 }))
      .mockResolvedValueOnce(mcRun({ status: "running", progress: { done: 10, total: 100 } }))
      .mockResolvedValue(MC_DONE);

    const { result } = renderHook(() => useMonteCarloQuery("mc-1"), { wrapper });
    await tick(10);
    expect(result.current.data?.status).toBe("queued");

    await tick(2050);
    expect(result.current.data?.status).toBe("running");

    await tick(2050);
    expect(result.current.data?.status).toBe("done");
    const calls = getMonteCarlo.mock.calls.length;

    await tick(20_000);
    expect(getMonteCarlo).toHaveBeenCalledTimes(calls);
  });

  it("stops on error", async () => {
    vi.useFakeTimers();
    getMonteCarlo.mockResolvedValue(mcRun({ status: "error", error: "boom" }));
    renderHook(() => useMonteCarloQuery("mc-1"), { wrapper });
    await tick(20_000);
    expect(getMonteCarlo).toHaveBeenCalledTimes(1);
  });

  it("stops after a failed poll (a 404)", async () => {
    vi.useFakeTimers();
    getMonteCarlo.mockRejectedValue(new ApiError(404, "gone"));
    renderHook(() => useMonteCarloQuery("mc-1"), { wrapper });
    await tick(20_000);
    expect(getMonteCarlo).toHaveBeenCalledTimes(1);
  });

  it("stays idle without a run id", async () => {
    vi.useFakeTimers();
    renderHook(() => useMonteCarloQuery(null), { wrapper });
    await tick(5000);
    expect(getMonteCarlo).not.toHaveBeenCalled();
  });
});
