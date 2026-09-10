import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { HistoryCard } from "./HistoryCard";

const historyItem = {
  simulation_id: "sim-1",
  rocket_id: "rocket-1",
  name: "acme-1",
  created_at: "2026-01-01T00:00:00Z",
  created_by: "pilot@multitec.dev",
  status: "done" as const,
  scalars: { apogee: 1000 },
  scenario: { name: "acme-1" },
  warnings: [],
  result_prefix: "results/sim-1/",
  plot_names: [],
  has_series: false,
};

const simulateMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    simulate: (...args: Parameters<typeof actual.simulate>) => simulateMock(...args),
  };
});

afterEach(() => {
  simulateMock.mockReset();
});

describe("HistoryCard (issue #52 — client island in the server-rendered /history list)", () => {
  it("renders the entry's own data", async () => {
    render(
      <AppProviders>
        <HistoryCard item={historyItem} />
      </AppProviders>,
    );

    expect(await screen.findByText("acme-1")).toBeInTheDocument();
  });

  it("re-runs an entry and navigates to the new result (issue #48 mutation)", async () => {
    simulateMock.mockResolvedValueOnce({
      run_id: "run-2",
      scalars: {},
      plot_urls: [],
      warnings: [],
    });
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    });

    render(
      <AppProviders>
        <HistoryCard item={historyItem} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Re-run"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/results/run-2"));
    expect(simulateMock).toHaveBeenCalledWith("rocket-1", historyItem.scenario);
  });

  it("shows an inline error when re-running fails", async () => {
    simulateMock.mockRejectedValueOnce(
      new ApiError(500, "boom", { code: "requestFailed" }),
    );

    render(
      <AppProviders>
        <HistoryCard item={historyItem} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Re-run"));

    expect(await screen.findByText("The request failed (code 500).")).toBeInTheDocument();
  });
});
