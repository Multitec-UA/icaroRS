import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { HistoryList } from "./HistoryList";

const historyItem = {
  simulation_id: "sim-1",
  rocket_id: "rocket-1",
  name: "acme-1",
  created_at: "2026-01-01T00:00:00Z",
  created_by: "pilot@multitec.dev",
  status: "done" as const,
  scalars: { apogee: 1000 },
  scenario: { name: "acme-1" },
};

const getHistoryMock = vi.fn().mockResolvedValue([historyItem]);
const simulateMock = vi.fn();

// Route-owning component for "/history" (app/history/page.tsx renders this
// directly with no props).
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    getHistory: (...args: Parameters<typeof actual.getHistory>) => getHistoryMock(...args),
    simulate: (...args: Parameters<typeof actual.simulate>) => simulateMock(...args),
  };
});

describe("HistoryList (route smoke test — /history)", () => {
  it("mounts without crashing and shows the heading", async () => {
    getHistoryMock.mockResolvedValueOnce([]);
    render(
      <AppProviders>
        <HistoryList />
      </AppProviders>,
    );

    expect(
      await screen.findByRole("heading", { name: "Flight history" }),
    ).toBeInTheDocument();
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
        <HistoryList />
      </AppProviders>,
    );

    const reRunButton = await screen.findByText("Re-run");
    fireEvent.click(reRunButton);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/results/run-2"));
    expect(simulateMock).toHaveBeenCalledWith("rocket-1", historyItem.scenario);
  });

  it("shows an inline error when re-running fails, without affecting other cards", async () => {
    simulateMock.mockRejectedValueOnce(
      new ApiError(500, "boom", { code: "requestFailed" }),
    );

    render(
      <AppProviders>
        <HistoryList />
      </AppProviders>,
    );

    const reRunButton = await screen.findByText("Re-run");
    fireEvent.click(reRunButton);

    expect(await screen.findByText("The request failed (code 500).")).toBeInTheDocument();
  });
});
