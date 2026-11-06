import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useSearchParams } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import type { MonteCarloRun, MonteCarloSummary } from "@/lib/api";
import { MC_DONE, mcRun } from "@/components/results/monteCarloFixtures";
import { RunsView } from "./RunsView";

/** S12 — /runs lists the rocket's Monte Carlo runs next to its simulations. */

const api = vi.hoisted(() => ({ listMonteCarlo: vi.fn(), getMonteCarlo: vi.fn(), getHistory: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    getRockets: vi.fn().mockResolvedValue([
      { rocket_id: "r2", name: "Icarus-2", created_at: "2026-02-01T00:00:00Z", created_by: "pilot@multitec.dev" },
    ]),
    getHistory: (...args: unknown[]) => api.getHistory(...args),
    listMonteCarlo: (...args: unknown[]) => api.listMonteCarlo(...args),
    getMonteCarlo: (...args: unknown[]) => api.getMonteCarlo(...args),
  };
});

/** A run as the list returns it: the summary, without `result`. */
function summary(run: MonteCarloRun, runId: string, overrides: Partial<MonteCarloSummary> = {}): MonteCarloSummary {
  const copy: Partial<MonteCarloRun> = { ...run };
  delete copy.result;
  return { ...(copy as MonteCarloSummary), run_id: runId, ...overrides };
}

const LIST = [
  summary(MC_DONE, "mc-done"),
  summary(mcRun({ status: "running", progress: { done: 42, total: 100 } }), "mc-run"),
  summary(mcRun({ status: "error", error: "boom" }), "mc-err", { n: 30 }),
];

afterEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
  vi.mocked(useSearchParams).mockReturnValue(new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>);
});

async function renderDispersion() {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams("rocket_id=r2") as unknown as ReturnType<typeof useSearchParams>,
  );
  api.getHistory.mockResolvedValue([]);
  api.listMonteCarlo.mockResolvedValue(LIST);
  api.getMonteCarlo.mockImplementation(async (id: string) => ({ ...MC_DONE, run_id: id }));
  render(
    <AppProviders>
      <RunsView />
    </AppProviders>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Dispersion" }));
  return within(await screen.findByRole("table", { name: "Dispersion runs of Icarus-2" }));
}

describe("RunsView — dispersion runs (S12)", () => {
  it("does not ask for dispersion runs until their tab is opened", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("rocket_id=r2") as unknown as ReturnType<typeof useSearchParams>,
    );
    api.getHistory.mockResolvedValue([]);
    render(
      <AppProviders>
        <RunsView />
      </AppProviders>,
    );
    expect(await screen.findByRole("button", { name: "Simulations" })).toHaveAttribute("aria-pressed", "true");
    expect(api.listMonteCarlo).not.toHaveBeenCalled();
  });

  it("lists the rocket's runs with status, flights and the median apogee once done", async () => {
    const table = await renderDispersion();

    expect(api.listMonteCarlo).toHaveBeenCalledWith("r2");
    const rows = table.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Done")).toBeInTheDocument();
    expect(within(rows[0]).getByText("100")).toBeInTheDocument();
    await waitFor(() => expect(within(rows[0]).getByText("795")).toBeInTheDocument());
    expect(within(rows[1]).getByText("42 / 100 flights")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Failed")).toBeInTheDocument();
    // Only finished runs are fetched for their result.
    expect(api.getMonteCarlo).toHaveBeenCalledWith("mc-done");
    expect(api.getMonteCarlo).not.toHaveBeenCalledWith("mc-run");
  });

  it("opens each run in the Workbench with its file and mc=", async () => {
    const table = await renderDispersion();
    const links = table.getAllByRole("link", { name: "Open in Workbench" });
    expect(links[0]).toHaveAttribute("href", "/?file=exp-1&mc=mc-done");
    expect(links[1]).toHaveAttribute("href", "/?file=exp-1&mc=mc-run");
  });

  it("says when the rocket has no dispersion runs", async () => {
    vi.mocked(useSearchParams).mockReturnValue(
      new URLSearchParams("rocket_id=r2") as unknown as ReturnType<typeof useSearchParams>,
    );
    api.getHistory.mockResolvedValue([]);
    api.listMonteCarlo.mockResolvedValue([]);
    render(
      <AppProviders>
        <RunsView />
      </AppProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Dispersion" }));
    expect(
      await screen.findByText("No dispersion runs for this rocket yet. Launch one from the Workbench."),
    ).toBeInTheDocument();
  });
});
