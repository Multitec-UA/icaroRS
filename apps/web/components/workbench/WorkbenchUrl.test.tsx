import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { useWizard } from "@/components/wizard/WizardProvider";
import { clearToasts } from "@/components/ui/Toast";
import { WorkbenchShell } from "./WorkbenchShell";

/**
 * S8 — the Workbench's state lives in its URL: `/?file={export_id}` while a
 * file is loaded and no run is shown, `/?run={run_id}` once a run is shown.
 * The URL is resolved on mount (and on back/forward), edits never touch the
 * history, a new run pushes, a 404 explains itself, and a run that finishes
 * after the user left the Workbench raises a toast.
 */

const nav = vi.hoisted(() => ({
  search: "",
  replace: vi.fn(),
  push: vi.fn(),
}));

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
  getRunSummary: vi.fn(),
  getExport: vi.fn(),
  getSeries: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    getRockets: vi.fn().mockResolvedValue([]),
    getRocket: vi.fn().mockRejectedValue(new actual.ApiError(404, "no")),
    getHistory: vi.fn().mockResolvedValue([]),
    suggestAtmosphere: vi.fn().mockResolvedValue({ model: "standard_atmosphere", reason: "ok", needs_internet: false }),
    getElevation: vi.fn().mockResolvedValue({ elevation: 42, source: "dem" }),
    simulate: (...args: unknown[]) => api.simulate(...args),
    getRunSummary: (...args: unknown[]) => api.getRunSummary(...args),
    getExport: (...args: unknown[]) => api.getExport(...args),
    getSeries: (...args: unknown[]) => api.getSeries(...args),
  };
});

vi.mock("@/components/map/SitePicker", () => ({ SitePicker: () => <div>site-picker-stub</div> }));
vi.mock("@/components/charts/Trajectory3D", () => ({ Trajectory3D: () => <div>trajectory-3d-stub</div> }));
vi.mock("@/components/charts/SeriesChart", () => ({ SeriesChart: () => <div>series-chart-stub</div> }));

const SCENARIO = {
  name: "workbench",
  site: { latitude: 38.2655, longitude: -0.6981, elevation: 42 },
  date: { year: 2026, month: 11, day: 7, hour: 10 },
  atmosphere: { model: "standard_atmosphere", fallback: "standard_atmosphere", file: null, station: null },
  rail: { length: 5.2 },
  uncertainty: {},
};

const SUMMARY = {
  simulation_id: "run-4",
  rocket_id: "rk-1",
  export_id: "exp-1",
  name: "Icarus-2",
  ork_filename: "icarus2.ork",
  created_at: "2026-10-29T17:42:00Z",
  created_by: "pilot@multitec.dev",
  status: "done",
  scenario: SCENARIO,
  scalars: { apogee: 1812.6 },
  warnings: ["Stored warning."],
  result_prefix: "orgs/o1/results/run-4/",
  plot_names: ["trajectory_3d", "altitude"],
  has_series: true,
};

const EXPORT = {
  export_id: "exp-1",
  rocket_id: "rk-1",
  name: "Icarus-2",
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
  api.getRunSummary.mockImplementation(async (id: string) => {
    if (id === "run-4") return SUMMARY;
    throw new ApiError(404, `Run '${id}' not found.`);
  });
  api.getExport.mockImplementation(async (id: string) => {
    if (id === "exp-1") return EXPORT;
    throw new ApiError(404, `Export '${id}' not found.`);
  });
  api.getSeries.mockRejectedValue(new ApiError(404, "no series"));
});

afterEach(() => {
  for (const mock of [nav.replace, nav.push, api.simulate, api.getRunSummary, api.getExport, api.getSeries]) {
    mock.mockReset();
  }
  clearToasts();
});

function SiteDriver() {
  const { setExport, setSite, state } = useWizard();
  return (
    <>
      <button type="button" onClick={() => setExport("exp-1", EXPORT.manifest, "rk-1", { filename: "icarus2.ork", rocketName: "Icarus-2" })}>
        seed-export
      </button>
      <button type="button" onClick={() => setSite({ latitude: 38.3452, longitude: -0.481, elevation: 12 })}>
        seed-site
      </button>
      <output data-testid="draft-name">{state.name}</output>
    </>
  );
}

function renderAt(search: string) {
  nav.search = search;
  return render(
    <AppProviders>
      <SiteDriver />
      <WorkbenchShell />
    </AppProviders>,
  );
}

describe("Workbench URL — resolving it on mount (S8)", () => {
  it("?run= loads the run's file, scenario and result and shows it up to date, without running", async () => {
    renderAt("?run=run-4");

    expect(await screen.findByText("Up to date · run run-4")).toBeInTheDocument();
    expect(api.getRunSummary).toHaveBeenCalledWith("run-4");
    expect(api.getExport).toHaveBeenCalledWith("exp-1");
    expect(screen.getByText("Icarus-2 · icarus2.ork")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Key results" })).toBeInTheDocument();
    expect(screen.getByText("Stored warning.")).toBeInTheDocument();
    expect(screen.getByLabelText("Latitude")).toHaveValue(38.2655);
    expect(screen.getByTestId("draft-name")).toHaveTextContent("workbench");
    expect(api.simulate).not.toHaveBeenCalled();
    // The URL already says what is on screen: nothing to write.
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("an edit after loading a run marks it changed and leaves the URL alone", async () => {
    renderAt("?run=run-4");
    await screen.findByText("Up to date · run run-4");

    fireEvent.change(screen.getByLabelText("Elevation (m)"), { target: { value: "120" } });

    expect(await screen.findByText("Changed since run run-4")).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "What changed" })).getByText("Site")).toBeInTheDocument();
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("?file= loads the file only: the rocket card is ready to run and no run is fetched", async () => {
    renderAt("?file=exp-1");

    expect(await screen.findByText("Icarus-2 · icarus2.ork")).toBeInTheDocument();
    expect(screen.getByText("No run yet")).toBeInTheDocument();
    expect(screen.getByText("Ready to run")).toBeInTheDocument();
    expect(api.getRunSummary).not.toHaveBeenCalled();
  });

  it("a missing run explains itself in the results column, and Start fresh clears the URL", async () => {
    renderAt("?run=does-not-exist");

    expect(await screen.findByText("This run's file is no longer available")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start fresh" }));

    expect(nav.replace).toHaveBeenCalledWith("/", { scroll: false });
    expect(await screen.findByText("Drop your OpenRocket file here")).toBeInTheDocument();
  });

  it("a run whose file is gone shows the same run message", async () => {
    api.getRunSummary.mockResolvedValueOnce({ ...SUMMARY, export_id: "exp-gone" });
    renderAt("?run=run-4");

    expect(await screen.findByText("This run's file is no longer available")).toBeInTheDocument();
    expect(screen.queryByText(/Up to date/)).toBeNull();
  });

  it("a missing file says so", async () => {
    renderAt("?file=exp-gone");

    expect(await screen.findByText("This file is no longer available")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start fresh" })).toBeInTheDocument();
  });

  it("a fresh / with no parameters still shows the drop zone and loads nothing", async () => {
    renderAt("");

    expect(await screen.findByText("Drop your OpenRocket file here")).toBeInTheDocument();
    expect(api.getRunSummary).not.toHaveBeenCalled();
    expect(api.getExport).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("going back from ?run= to ?file= of the same file takes the run off screen and keeps the draft", async () => {
    const view = renderAt("?run=run-4");
    await screen.findByText("Up to date · run run-4");

    nav.search = "?file=exp-1";
    view.rerender(
      <AppProviders>
        <SiteDriver />
        <WorkbenchShell />
      </AppProviders>,
    );

    expect(await screen.findByText("No run yet")).toBeInTheDocument();
    expect(screen.getByText("Ready to run")).toBeInTheDocument();
    expect(screen.getByLabelText("Latitude")).toHaveValue(38.2655);
  });
});

describe("Workbench URL — writing it (S8)", () => {
  it("replaces to ?file= when a file is loaded, pushes ?run= for a new run, and edits never write", async () => {
    api.simulate.mockResolvedValueOnce({ run_id: "run-new", scalars: { apogee: 1 }, plot_urls: [], warnings: [] });
    renderAt("");
    const run = await screen.findByRole("button", { name: /Run simulation/ });

    fireEvent.click(screen.getByText("seed-export"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/?file=exp-1", { scroll: false }));
    nav.search = "?file=exp-1";

    fireEvent.click(screen.getByText("seed-site"));
    await waitFor(() => expect(run).toBeEnabled());
    expect(nav.replace).toHaveBeenCalledTimes(1);

    fireEvent.click(run);
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/?run=run-new", { scroll: false }));
    expect(nav.replace).toHaveBeenCalledTimes(1);
  });
});

describe("Workbench — a run that finishes after leaving (S8)", () => {
  function Toggle() {
    const [shown, setShown] = useState(true);
    return (
      <>
        <button type="button" onClick={() => setShown(false)}>
          leave
        </button>
        {shown && <WorkbenchShell />}
      </>
    );
  }

  async function startRunThenLeave() {
    nav.search = "";
    render(
      <AppProviders>
        <SiteDriver />
        <Toggle />
      </AppProviders>,
    );
    const run = await screen.findByRole("button", { name: /Run simulation/ });
    fireEvent.click(screen.getByText("seed-export"));
    fireEvent.click(screen.getByText("seed-site"));
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    fireEvent.click(screen.getByText("leave"));
    expect(screen.queryByRole("button", { name: /Run/ })).toBeNull();
  }

  it("keeps running and toasts 'Run {id} finished' with a link to its Workbench URL", async () => {
    let resolve: (value: unknown) => void = () => {};
    api.simulate.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    await startRunThenLeave();

    resolve({ run_id: "run-late", scalars: {}, plot_urls: [], warnings: [] });

    expect(await screen.findByText("Run run-late finished")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open" })).toHaveAttribute("href", "/?run=run-late");
  });

  it("toasts the failure with the server detail", async () => {
    let reject: (reason: unknown) => void = () => {};
    api.simulate.mockReturnValueOnce(new Promise((_, r) => (reject = r)));
    await startRunThenLeave();

    reject(new ApiError(500, "Core crashed", { code: "requestFailed" }));

    expect(await screen.findByText("Run failed: Core crashed")).toBeInTheDocument();
  });

  it("does not toast while the Workbench is still on screen", async () => {
    api.simulate.mockResolvedValueOnce({ run_id: "run-here", scalars: {}, plot_urls: [], warnings: [] });
    renderAt("");
    const run = await screen.findByRole("button", { name: /Run simulation/ });
    fireEvent.click(screen.getByText("seed-export"));
    fireEvent.click(screen.getByText("seed-site"));
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);

    expect(await screen.findByText("Up to date · run run-here")).toBeInTheDocument();
    expect(screen.queryByText("Run run-here finished")).toBeNull();
  });
});
