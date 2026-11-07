import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import type { MonteCarloRun } from "@/lib/api";
import { MonteCarloReport } from "./MonteCarloReport";
import { MC_DONE, mcRun } from "./monteCarloFixtures";

/** The dispersion report at /results/mc/{run_id}: what the Workbench card shows, from the logbook. */

const api = vi.hoisted(() => ({ getMonteCarlo: vi.fn(), getRocket: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    getMonteCarlo: (...args: unknown[]) => api.getMonteCarlo(...args),
    getRocket: (...args: unknown[]) => api.getRocket(...args),
  };
});

// Leaflet needs `window` at import time; the map is checked through its props.
vi.mock("@/components/map/LandingEllipseMap", () => ({
  LandingEllipseMap: ({ layers }: { layers: { sigma: number }[] }) => (
    <div data-testid="ellipse-map">{layers.map((layer) => `${layer.sigma}σ`).join(",")}</div>
  ),
}));

afterEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

function renderReport(run: MonteCarloRun, units: "metric" | "imperial" = "metric") {
  api.getMonteCarlo.mockResolvedValue(run);
  api.getRocket.mockResolvedValue({ rocket_id: run.rocket_id, name: "Icarus-2", exports: [] });
  return render(
    <AppProviders units={units}>
      <MonteCarloReport runId={run.run_id} initialRun={run} />
    </AppProviders>,
  );
}

describe("MonteCarloReport — a finished run", () => {
  it("renders the Workbench results, the KML download and the way back to the Workbench", async () => {
    renderReport(MC_DONE);

    // AuthGate renders the page once the identity resolves.
    expect(await screen.findByRole("heading", { level: 1, name: "Dispersion · 100 flights" })).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Flights" })).getByText("97")).toBeInTheDocument();
    expect(screen.getByTestId("ellipse-map")).toHaveTextContent("1σ,2σ,3σ");
    expect(screen.getByRole("link", { name: "Download KML" })).toHaveAttribute("href", "/api/montecarlo/mc-1/kml");
    expect(screen.getByRole("link", { name: "Open in Workbench" })).toHaveAttribute("href", "/?file=exp-1&mc=mc-1");
    // The breadcrumb names the rocket once its lookup resolves.
    expect(await screen.findByRole("link", { name: "Icarus-2" })).toHaveAttribute("href", "/runs?rocket_id=rk-1");
  });
});

describe("MonteCarloReport — a run without results yet", () => {
  it.each([
    ["queued", mcRun({ status: "queued", queue_position: 2 }), "Waiting behind 2 runs"],
    ["running", mcRun({ status: "running", progress: { done: 42, total: 100 } }), "42 / 100 flights"],
    ["error", mcRun({ status: "error", error: "Solver diverged" }), "Solver diverged"],
  ] as const)("%s shows its status and no results", async (_status, run, text) => {
    renderReport(run);

    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByTestId("ellipse-map")).toBeNull();
    expect(screen.queryByRole("link", { name: "Download KML" })).toBeNull();
    expect(screen.getByRole("link", { name: "Open in Workbench" })).toHaveAttribute("href", "/?file=exp-1&mc=mc-1");
  });
});

describe("MonteCarloReport — imperial units", () => {
  it("renders the apogee statistics in ft", async () => {
    renderReport(MC_DONE, "imperial");
    expect(await screen.findByRole("heading", { level: 1, name: "Dispersion · 100 flights" })).toBeInTheDocument();
    expect(screen.getByText("2,603 ft ± 151 ft")).toBeInTheDocument();
    expect(screen.getByText("2,608 ft")).toBeInTheDocument();
  });
});
