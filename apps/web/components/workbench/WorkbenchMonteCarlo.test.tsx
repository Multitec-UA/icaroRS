import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { useWizard } from "@/components/wizard/WizardProvider";
import { MC_DONE, mcRun } from "@/components/results/monteCarloFixtures";
import { WorkbenchShell } from "./WorkbenchShell";

/**
 * S12 — a Monte Carlo run launched from the Workbench: it is queued with the
 * active file and the scenario on screen, rides along in the URL as `mc=`
 * (so a reload resumes it), and never blocks the deterministic Run.
 */

const nav = vi.hoisted(() => ({ search: "", replace: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: nav.push,
    replace: nav.replace,
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const api = vi.hoisted(() => ({
  simulate: vi.fn(),
  getExport: vi.fn(),
  getRocket: vi.fn(),
  submitMonteCarlo: vi.fn(),
  getMonteCarlo: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    getRockets: vi.fn().mockResolvedValue([]),
    getHistory: vi.fn().mockResolvedValue([]),
    getSeries: vi.fn().mockRejectedValue(new actual.ApiError(404, "no series")),
    suggestAtmosphere: vi.fn().mockResolvedValue({ model: "standard_atmosphere", reason: "ok", needs_internet: false }),
    getElevation: vi.fn().mockResolvedValue({ elevation: 42, source: "dem" }),
    getRocket: (...args: unknown[]) => api.getRocket(...args),
    getExport: (...args: unknown[]) => api.getExport(...args),
    simulate: (...args: unknown[]) => api.simulate(...args),
    submitMonteCarlo: (...args: unknown[]) => api.submitMonteCarlo(...args),
    getMonteCarlo: (...args: unknown[]) => api.getMonteCarlo(...args),
  };
});

vi.mock("@/components/map/SitePicker", () => ({ SitePicker: () => <div>site-picker-stub</div> }));
vi.mock("@/components/map/LandingEllipseMap", () => ({ LandingEllipseMap: () => <div>ellipse-map-stub</div> }));
vi.mock("@/components/charts/Trajectory3D", () => ({ Trajectory3D: () => <div>trajectory-3d-stub</div> }));
vi.mock("@/components/charts/SeriesChart", () => ({ SeriesChart: () => <div>series-chart-stub</div> }));

const EXPORT = {
  export_id: "exp-1",
  rocket_id: "rk-1",
  name: "Icarus design v3",
  created_at: "2026-10-20T10:00:00Z",
  created_by: "pilot@multitec.dev",
  export_prefix: "orgs/o1/exports/exp-1/",
  gcs_ref: "orgs/o1/exports/exp-1/",
  ork_filename: "icarus2.ork",
  has_source_ork: true,
  manifest: { flight: { rail_length: 4, inclination: 85, heading: 90 } },
};

beforeEach(() => {
  nav.search = "";
  api.getRocket.mockResolvedValue({
    rocket_id: "rk-1",
    name: "Icarus-2",
    created_at: "2026-10-20T10:00:00Z",
    created_by: "pilot@multitec.dev",
    exports: [],
  });
  api.getExport.mockImplementation(async (id: string) => {
    if (id === "exp-1") return EXPORT;
    throw new ApiError(404, `Export '${id}' not found.`);
  });
});

afterEach(() => {
  for (const mock of [nav.replace, nav.push, ...Object.values(api)]) mock.mockReset();
  sessionStorage.clear();
});

function SiteDriver() {
  const { setSite } = useWizard();
  return (
    <button type="button" onClick={() => setSite({ latitude: 38.3452, longitude: -0.481, elevation: 12 })}>
      seed-site
    </button>
  );
}

async function renderAt(search: string) {
  nav.search = search;
  render(
    <AppProviders>
      <SiteDriver />
      <WorkbenchShell />
    </AppProviders>,
  );
  await screen.findByText("Icarus-2 · icarus2.ork");
  fireEvent.click(screen.getByText("seed-site"));
}

describe("Workbench — Monte Carlo dispersion (S12)", () => {
  it("queues the active file and scenario, then puts the run in the URL", async () => {
    api.submitMonteCarlo.mockResolvedValue({ run_id: "mc-1", status: "queued", queue_position: 1 });
    await renderAt("?file=exp-1");

    fireEvent.click(screen.getByRole("button", { name: "Dispersion" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Flights" }), { target: { value: "50" } });
    const submit = screen.getByRole("button", { name: "Run dispersion" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(api.submitMonteCarlo).toHaveBeenCalledTimes(1));
    expect(api.submitMonteCarlo).toHaveBeenCalledWith({
      export_id: "exp-1",
      n: 50,
      scenario: expect.objectContaining({ site: { latitude: 38.3452, longitude: -0.481, elevation: 12 } }),
    });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/?file=exp-1&mc=mc-1", { scroll: false }));
    expect(api.simulate).not.toHaveBeenCalled();
  });

  it("a reload with mc= resumes the run: progress shows and Run stays usable", async () => {
    api.getMonteCarlo.mockResolvedValue(mcRun({ status: "running", progress: { done: 42, total: 100 } }));
    api.simulate.mockResolvedValue({ run_id: "run-9", scalars: {}, plot_urls: [], warnings: [] });
    await renderAt("?file=exp-1&mc=mc-1");

    expect(await screen.findByText("42 / 100 flights")).toBeInTheDocument();
    expect(api.getMonteCarlo).toHaveBeenCalledWith("mc-1");

    const run = screen.getByRole("button", { name: /Run simulation/ });
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);

    await waitFor(() => expect(api.simulate).toHaveBeenCalledTimes(1));
    // The deterministic run is pushed and the dispersion run stays with it.
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/?run=run-9&mc=mc-1", { scroll: false }));
    expect(screen.getByText("42 / 100 flights")).toBeInTheDocument();
  });

  it("a finished run reloads straight into its results", async () => {
    api.getMonteCarlo.mockResolvedValue(MC_DONE);
    await renderAt("?file=exp-1&mc=mc-1");

    expect(await screen.findByText("ellipse-map-stub")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Download KML" })).toHaveAttribute("href", "/api/montecarlo/mc-1/kml");
  });

  it("closing the card takes mc= off the URL", async () => {
    api.getMonteCarlo.mockResolvedValue(MC_DONE);
    await renderAt("?file=exp-1&mc=mc-1");
    fireEvent.click(await screen.findByRole("button", { name: "Close dispersion" }));
    expect(nav.replace).toHaveBeenCalledWith("/?file=exp-1", { scroll: false });
  });
});
