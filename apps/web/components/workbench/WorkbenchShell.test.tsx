import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { useWizard } from "@/components/wizard/WizardProvider";
import { WorkbenchShell } from "./WorkbenchShell";

const { simulateMock, suggestAtmosphereMock, getElevationMock, getSeriesMock } =
  vi.hoisted(() => ({
    simulateMock: vi.fn(),
    suggestAtmosphereMock: vi.fn(),
    getElevationMock: vi.fn(),
    getSeriesMock: vi.fn(),
  }));

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
    suggestAtmosphere: (...args: Parameters<typeof actual.suggestAtmosphere>) =>
      suggestAtmosphereMock(...args),
    getElevation: (...args: Parameters<typeof actual.getElevation>) => getElevationMock(...args),
    getSeries: (...args: Parameters<typeof actual.getSeries>) => getSeriesMock(...args),
    // An empty org: the results column shows only the drop zone (S8/A1), so
    // these shell tests stay about the shell's own wiring.
    getRockets: vi.fn().mockResolvedValue([]),
  };
});

// Leaflet (SitePicker → MapInner) and three/echarts (the flight replay and
// series chart) touch `window` at import time and are irrelevant to the
// shell's wiring under test; the flight components have their own tests.
vi.mock("@/components/map/SitePicker", () => ({
  SitePicker: () => <div>site-picker-stub</div>,
}));
vi.mock("@/components/charts/Trajectory3D", () => ({
  Trajectory3D: () => <div>trajectory-3d-stub</div>,
}));
vi.mock("@/components/charts/SeriesChart", () => ({
  SeriesChart: () => <div>series-chart-stub</div>,
}));

const RESULT: { run_id: string; scalars: Record<string, number>; plot_urls: string[]; warnings: string[] } = {
  run_id: "run-7f3a",
  scalars: { apogee: 3142 },
  plot_urls: [],
  warnings: ["Stability margin at rail exit is low."],
};

const SERIES = {
  t: [0, 1, 2, 3],
  altitude: [0, 100, 300, 200],
  speed: [0, 50, 30, 10],
  path3d: [
    [0, 0, 0],
    [3, 4, 100],
    [6, 8, 300],
    [9, 12, 200],
  ],
};

/** Drives WizardProvider the way RocketStep / RocketCard / the map would. */
function Driver() {
  const { setExport, setSite, setAtmosphere } = useWizard();
  return (
    <>
      <button
        type="button"
        onClick={() =>
          setExport("export-1", { name: "Icarus-2" }, "rocket-1", {
            filename: "icarus2.ork",
            rocketName: "Icarus-2",
          })
        }
      >
        seed-export
      </button>
      <button
        type="button"
        onClick={() =>
          setExport("export-2", { name: "Icarus-2" }, "rocket-1", {
            filename: "icarus2_v2.ork",
            rocketName: "Icarus-2",
          })
        }
      >
        seed-export-2
      </button>
      <button
        type="button"
        onClick={() => setSite({ latitude: 38.3452, longitude: -0.481, elevation: 12 })}
      >
        seed-site
      </button>
      <button
        type="button"
        onClick={() =>
          setAtmosphere({ model: "forecast", file: null, station: null, fallback: "standard_atmosphere" })
        }
      >
        seed-forecast
      </button>
    </>
  );
}

async function renderShell() {
  render(
    <AppProviders>
      <Driver />
      <WorkbenchShell />
    </AppProviders>,
  );
  return screen.findByRole("button", { name: /Run simulation/ });
}

async function seedReady() {
  const run = await renderShell();
  fireEvent.click(screen.getByText("seed-export"));
  fireEvent.click(screen.getByText("seed-site"));
  await waitFor(() => expect(run).toBeEnabled());
  return run;
}

/** The chips naming what changed since the displayed run. */
function changedChips() {
  return screen.getByRole("list", { name: "What changed" });
}

afterEach(() => {
  sessionStorage.clear();
  simulateMock.mockReset();
  suggestAtmosphereMock.mockReset();
  getElevationMock.mockReset();
  getSeriesMock.mockReset();
});

function arm() {
  getSeriesMock.mockResolvedValue(SERIES);
  suggestAtmosphereMock.mockResolvedValue({
    model: "forecast",
    reason: "GFS forecast available — launch is 14 days out.",
    needs_internet: true,
  });
  getElevationMock.mockResolvedValue({ elevation: 12, source: "dem" });
}

describe("WorkbenchShell — Run guard (S7)", () => {
  it("keeps Run disabled until an export and a finite launch site exist", async () => {
    arm();
    const run = await renderShell();
    expect(run).toBeDisabled();

    fireEvent.click(screen.getByText("seed-export"));
    expect(run).toBeDisabled();

    fireEvent.click(screen.getByText("seed-site"));
    await waitFor(() => expect(run).toBeEnabled());
  });

  it("keeps Run disabled when the weather model needs a date until one is typed", async () => {
    arm();
    const run = await seedReady();

    fireEvent.click(screen.getByText("seed-forecast"));
    await waitFor(() => expect(run).toBeDisabled());
    expect(screen.getByText("This weather model needs a launch date.")).toBeInTheDocument();

    // The field's label also wraps an InfoTip button; target the input itself.
    fireEvent.change(screen.getByLabelText(/^Launch · your time/, { selector: "input" }), {
      target: { value: "2026-06-01T09:00" },
    });
    await waitFor(() => expect(run).toBeEnabled());
    // The date triggers the atmosphere suggestion, rendered verbatim (API English).
    expect(await screen.findByText("GFS forecast available — launch is 14 days out.")).toBeInTheDocument();
  });
});

describe("WorkbenchShell — the disabled Run button says why (S12f)", () => {
  const reason = () => document.getElementById("run-reason");

  it("names the missing site, then the missing date, in its title and a visible helper", async () => {
    arm();
    const run = await renderShell();
    // No file: the import is the next step, so no field is named.
    expect(run).not.toHaveAttribute("title");
    expect(reason()).toBeNull();

    fireEvent.click(screen.getByText("seed-export"));
    fireEvent.click(screen.getByText("seed-forecast"));
    await waitFor(() => expect(run).toHaveAttribute("title", "Pick a launch site first"));
    expect(screen.getByText("Pick a launch site first")).toHaveClass("text-xs", "text-muted");
    expect(run).toHaveAccessibleDescription("Pick a launch site first");

    fireEvent.click(screen.getByText("seed-site"));
    await waitFor(() => expect(run).toHaveAttribute("title", "Pick a launch date first"));
    expect(screen.getByText("Pick a launch date first")).toBeInTheDocument();
    expect(screen.queryByText("Pick a launch site first")).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Launch · your time/, { selector: "input" }), {
      target: { value: "2026-06-01T09:00" },
    });
    await waitFor(() => expect(run).toBeEnabled());
    expect(run).not.toHaveAttribute("title");
    expect(reason()).toBeNull();
  });

  it("says Running… while a run is in flight", async () => {
    arm();
    simulateMock.mockReturnValueOnce(new Promise(() => {}));
    const run = await seedReady();
    fireEvent.click(run);

    const busy = await screen.findByRole("button", { name: /Simulating…/ });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("title", "Running…");
    expect(reason()).toHaveTextContent("Running…");
  });
});

describe("WorkbenchShell — running in place (S7)", () => {
  it("calls simulate with the export id and the scenario body, then shows the results in place", async () => {
    arm();
    simulateMock.mockResolvedValueOnce(RESULT);
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
      bfcacheId: "test",
    });
    const run = await seedReady();

    const placeholder = "Ready to run";
    expect(screen.getByText(placeholder)).toBeInTheDocument();
    expect(screen.queryByText(/Up to date/)).toBeNull();

    fireEvent.click(run);

    await waitFor(() =>
      expect(simulateMock).toHaveBeenCalledWith(
        "export-1",
        expect.objectContaining({
          site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
          atmosphere: expect.objectContaining({ model: "standard_atmosphere" }),
          uncertainty: {},
        }),
      ),
    );
    // No rail override typed: the file's own rail is used, no rail key is sent.
    expect(simulateMock.mock.calls[0][1]).not.toHaveProperty("rail");
    expect(await screen.findByText("trajectory-3d-stub")).toBeInTheDocument();
    expect(getSeriesMock).toHaveBeenCalledWith("run-7f3a");
    expect(screen.getByText("Stability margin at rail exit is low.")).toBeInTheDocument();
    expect(screen.queryByText(placeholder)).toBeNull();
    // It stays on the Workbench: the only navigation is the URL naming the new run (S8).
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith("/?run=run-7f3a", { scroll: false });
  });

  it("shows 'Up to date' after a run; another export starts clean with no run on screen", async () => {
    arm();
    simulateMock.mockResolvedValueOnce(RESULT);
    const run = await seedReady();

    fireEvent.click(run);

    expect(await screen.findByText("Up to date · run run-7f3a")).toBeInTheDocument();

    fireEvent.click(screen.getByText("seed-export-2"));

    await waitFor(() => expect(screen.queryByText("Up to date · run run-7f3a")).toBeNull());
    expect(screen.queryByText("Changed since run run-7f3a")).toBeNull();
    expect(screen.queryByRole("region", { name: "Key results" })).toBeNull();
    expect(run).toHaveTextContent("Run simulation");
  });

  it("runs on Cmd/Ctrl+Enter, but not without the modifier and not while Run is disabled", async () => {
    arm();
    simulateMock.mockResolvedValue(RESULT);
    const run = await renderShell();

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(simulateMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("seed-export"));
    fireEvent.click(screen.getByText("seed-site"));
    await waitFor(() => expect(run).toBeEnabled());

    fireEvent.keyDown(window, { key: "Enter" });
    expect(simulateMock).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    await waitFor(() => expect(simulateMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(run).toBeEnabled());

    fireEvent.keyDown(window, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(simulateMock).toHaveBeenCalledTimes(2));
  });

  it("shows a 422 field error next to its field", async () => {
    arm();
    simulateMock.mockRejectedValueOnce(
      new ApiError(422, "invalid", {
        code: "validation",
        fieldErrors: [
          { loc: ["site", "latitude"], field: "site.latitude", message: "Latitude out of range" },
        ],
      }),
    );
    const run = await seedReady();

    fireEvent.click(run);

    const error = await screen.findByText("Latitude out of range");
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("aria-describedby", error.id);
    expect(screen.getByLabelText("Latitude")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows the server's 503 hint verbatim", async () => {
    arm();
    simulateMock.mockRejectedValueOnce(
      new ApiError(503, "unavailable", {
        code: "unavailable",
        hint: "Java is not installed on the server.",
      }),
    );
    const run = await seedReady();

    fireEvent.click(run);

    expect(await screen.findByText("Java is not installed on the server.")).toBeInTheDocument();
  });
});

describe("WorkbenchShell — status from the displayed run (S6)", () => {
  it("reads 'No run yet' and 'Run simulation' before the first run, 'Run again' afterwards", async () => {
    arm();
    simulateMock.mockResolvedValueOnce(RESULT);
    const run = await seedReady();
    expect(screen.getByText("No run yet")).toBeInTheDocument();

    fireEvent.click(run);

    expect(await screen.findByText("Up to date · run run-7f3a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run again/ })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Run simulation/ })).toBeNull();
  });

  it("editing the site after a run shows Changed since run with a Site chip", async () => {
    arm();
    simulateMock.mockResolvedValueOnce(RESULT);
    const run = await seedReady();
    fireEvent.click(run);
    expect(await screen.findByText("Up to date · run run-7f3a")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Elevation (m)"), { target: { value: "40" } });

    expect(await screen.findByText("Changed since run run-7f3a")).toBeInTheDocument();
    const chips = changedChips();
    expect(within(chips).getByText("Site")).toBeInTheDocument();
    expect(within(chips).queryByText("File")).toBeNull();
    // Never disabled only because something (or nothing) changed.
    expect(screen.getByRole("button", { name: /Run again/ })).toBeEnabled();
  });

  it("a run of the same scenario twice stays Up to date", async () => {
    arm();
    simulateMock.mockResolvedValueOnce(RESULT).mockResolvedValueOnce({ ...RESULT, run_id: "run-8b1c" });
    const run = await seedReady();
    fireEvent.click(run);
    expect(await screen.findByText("Up to date · run run-7f3a")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Run again/ }));

    expect(await screen.findByText("Up to date · run run-8b1c")).toBeInTheDocument();
    expect(screen.queryByText(/Changed since run/)).toBeNull();
  });

  it("says Running… while a run is in flight and keeps edits made meanwhile, showing the result as changed", async () => {
    arm();
    let resolveRun: (value: typeof RESULT) => void = () => {};
    simulateMock.mockReturnValueOnce(new Promise<typeof RESULT>((resolve) => (resolveRun = resolve)));
    const run = await seedReady();
    fireEvent.click(run);

    expect(await screen.findByRole("button", { name: /Simulating…/ })).toBeDisabled();
    // The status pill, and the disabled button's reason (S12f).
    expect(screen.getAllByText("Running…")).toHaveLength(2);

    fireEvent.change(screen.getByLabelText("Elevation (m)"), { target: { value: "40" } });
    resolveRun(RESULT);

    expect(await screen.findByText("Changed since run run-7f3a")).toBeInTheDocument();
    expect(within(changedChips()).getByText("Site")).toBeInTheDocument();
    expect(screen.getByLabelText("Elevation (m)")).toHaveValue(40);
  });

  it("shows the rocket card, and no status pill, once an export is active before the first run", async () => {
    arm();
    await renderShell();

    fireEvent.click(screen.getByText("seed-export"));

    expect(await screen.findByText("Ready to run")).toBeInTheDocument();
    expect(
      screen.getByText("Review the scenario on the left, then run the simulation. Results appear here."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Drop your OpenRocket file here")).toBeNull();
    expect(screen.queryByText(/Up to date/)).toBeNull();
    expect(screen.getByText("No run yet")).toBeInTheDocument();
  });
});

describe("WorkbenchShell — top bar context", () => {
  it("names the active rocket and file, or says no rocket is selected", async () => {
    arm();
    await renderShell();
    expect(screen.getByText("No rocket selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("seed-export"));

    expect(await screen.findByText("Icarus-2 · icarus2.ork")).toBeInTheDocument();
  });
});

describe("WorkbenchShell — results column (S9)", () => {
  // `prepare` runs after arm(), which resolves the series by default.
  async function runOnce(result = RESULT, prepare?: () => void) {
    arm();
    prepare?.();
    simulateMock.mockResolvedValueOnce(result);
    const run = await seedReady();
    fireEvent.click(run);
    await waitFor(() => expect(simulateMock).toHaveBeenCalledTimes(1));
  }

  it("shows skeletons while the series loads, then the replay, KPIs, chart and timeline", async () => {
    let resolveSeries: (value: typeof SERIES) => void = () => {};
    await runOnce(
      {
        ...RESULT,
        scalars: { apogee_m: 3142.2, apogee_time_s: 21.8, flight_time_s: 142, impact_velocity_ms: 8.4 },
      },
      () => {
        getSeriesMock.mockReturnValue(new Promise<typeof SERIES>((resolve) => (resolveSeries = resolve)));
      },
    );

    expect(await screen.findByRole("status", { name: "Loading flight data…" })).toBeInTheDocument();
    // Scalars-only pieces do not wait for the series.
    expect(screen.getByRole("group", { name: "Apogee" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Flight timeline" })).toBeInTheDocument();
    expect(screen.queryByText("trajectory-3d-stub")).toBeNull();

    resolveSeries(SERIES);

    expect(await screen.findByText("trajectory-3d-stub")).toBeInTheDocument();
    expect(await screen.findByText("series-chart-stub")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading flight data…" })).toBeNull();
    expect(screen.getByText("Flight replay")).toBeInTheDocument();
    // The counted-up value itself is KpiCards.test's job (the global motion
    // stub keeps CountUp at 0); here the card and its caption are composed.
    expect(screen.getByRole("group", { name: "Apogee" })).toHaveTextContent("at 21.8 s");
    expect(screen.getByRole("list", { name: "Flight timeline" })).toBeInTheDocument();
  });

  it("falls back to the KPIs, the timeline and the static plots when the series 404s", async () => {
    arm();
    getSeriesMock.mockRejectedValue(new ApiError(404, "Series not found."));
    simulateMock.mockResolvedValueOnce({
      ...RESULT,
      scalars: { apogee_m: 3142.2, apogee_time_s: 21.8 },
      plot_urls: ["/api/results/run-7f3a/plots/linear_kinematics.png", "/api/results/run-7f3a/plots/energy.png"],
    });
    const run = await seedReady();
    fireEvent.click(run);

    expect(await screen.findByText("This run has no flight data to replay. The static plots are under Plots.")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Plots"));
    expect(await screen.findByText("Linear kinematics")).toBeInTheDocument();
    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Apogee" })).toHaveTextContent("at 21.8 s");
    expect(screen.getByRole("list", { name: "Flight timeline" })).toBeInTheDocument();
    expect(screen.queryByText("trajectory-3d-stub")).toBeNull();
    expect(screen.queryByText("series-chart-stub")).toBeNull();
  });

  it("collapses the warnings banner past two warnings", async () => {
    await runOnce({
      ...RESULT,
      warnings: ["Warning one.", "Warning two.", "Warning three.", "Warning four."],
    });

    expect(await screen.findByText("Warning one.")).toBeInTheDocument();
    expect(screen.getByText("Warning two.")).toBeInTheDocument();
    expect(screen.queryByText("Warning three.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Show all 4 warnings" }));

    expect(screen.getByText("Warning three.")).toBeInTheDocument();
    expect(screen.getByText("Warning four.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(screen.queryByText("Warning three.")).toBeNull();
  });

  it("shows two or fewer warnings in full, without a toggle", async () => {
    await runOnce({ ...RESULT, warnings: ["Warning one.", "Warning two."] });

    expect(await screen.findByText("Warning one.")).toBeInTheDocument();
    expect(screen.getByText("Warning two.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });
});

describe("WorkbenchShell — phone tabs (S10)", () => {
  function tabs() {
    const list = screen.getByRole("tablist", { name: "Workbench view" });
    return {
      list,
      inputs: within(list).getByRole("tab", { name: "Inputs" }),
      result: within(list).getByRole("tab", { name: "Result" }),
    };
  }
  const inputsColumn = () => screen.getByRole("complementary", { name: "Inputs" });
  const resultsColumn = () => screen.getByRole("region", { name: "Results" });

  it("shows no tabs while no file is loaded: the results column (import) is the whole phone screen", async () => {
    await renderShell();
    expect(screen.queryByRole("tablist", { name: "Workbench view" })).toBeNull();
    expect(inputsColumn()).toHaveClass("max-lg:hidden");
    expect(resultsColumn()).not.toHaveClass("max-lg:hidden");
    // Hidden below lg only: desktop keeps both columns.
    expect(inputsColumn()).not.toHaveAttribute("hidden");
  });

  it("shows the tabs once a file is loaded, opening on Inputs", async () => {
    arm();
    await renderShell();
    fireEvent.click(screen.getByText("seed-export"));
    const { list, inputs, result } = tabs();

    expect(inputs).toHaveAttribute("aria-selected", "true");
    expect(result).toHaveAttribute("aria-selected", "false");
    expect(inputs).toHaveAttribute("aria-controls", inputsColumn().id);
    expect(result).toHaveAttribute("aria-controls", resultsColumn().id);
    // Desktop renders both columns and no tabs: hiding is scoped to < lg.
    expect(list).toHaveClass("lg:hidden");
    expect(resultsColumn()).toHaveClass("max-lg:hidden");
    expect(inputsColumn()).not.toHaveClass("max-lg:hidden");
  });

  it("switches to Result when Run is pressed, before the result arrives", async () => {
    arm();
    let resolveRun: (value: typeof RESULT) => void = () => {};
    simulateMock.mockReturnValueOnce(new Promise<typeof RESULT>((resolve) => (resolveRun = resolve)));
    const run = await seedReady();
    expect(tabs().inputs).toHaveAttribute("aria-selected", "true");

    fireEvent.click(run);
    expect(tabs().result).toHaveAttribute("aria-selected", "true");
    expect(inputsColumn()).toHaveClass("max-lg:hidden");
    expect(resultsColumn()).not.toHaveClass("max-lg:hidden");

    resolveRun(RESULT);
    await screen.findByText("Up to date · run run-7f3a");
    expect(tabs().result).toHaveAttribute("aria-selected", "true");
  });

  it("Cmd/Ctrl+Enter switches to Result like the button", async () => {
    arm();
    simulateMock.mockResolvedValueOnce(RESULT);
    await seedReady();
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(tabs().result).toHaveAttribute("aria-selected", "true");
    await screen.findByText("Up to date · run run-7f3a");
  });

  it("never switches tabs when a result arrives later", async () => {
    arm();
    let resolveRun: (value: typeof RESULT) => void = () => {};
    simulateMock.mockReturnValueOnce(new Promise<typeof RESULT>((resolve) => (resolveRun = resolve)));
    const run = await seedReady();
    fireEvent.click(run);
    // Back to Inputs while the run is in flight: the arriving result leaves it there.
    fireEvent.click(tabs().inputs);
    resolveRun(RESULT);

    await screen.findByText("Up to date · run run-7f3a");
    expect(tabs().inputs).toHaveAttribute("aria-selected", "true");
    expect(resultsColumn()).toHaveClass("max-lg:hidden");
  });

  it("keeps the inputs column mounted, with its values, across a tab switch; arrows move between tabs", async () => {
    await renderShell();
    fireEvent.click(screen.getByText("seed-export"));
    fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "38.5" } });
    await waitFor(() => expect(screen.getByLabelText("Latitude")).toHaveValue(38.5));
    // The column element itself must survive (vitest.setup's motion stub
    // remounts Reveal children on every render, so inner nodes cannot be
    // compared by identity in jsdom).
    const column = inputsColumn();

    fireEvent.click(tabs().result);
    expect(tabs().result).toHaveAttribute("aria-selected", "true");
    expect(inputsColumn()).toBe(column);
    expect(column).toHaveClass("max-lg:hidden");
    expect(screen.getByLabelText("Latitude")).toHaveValue(38.5);

    fireEvent.keyDown(tabs().result, { key: "ArrowLeft" });
    expect(tabs().inputs).toHaveAttribute("aria-selected", "true");
    expect(tabs().inputs).toHaveFocus();
    expect(inputsColumn()).toBe(column);
    expect(screen.getByLabelText("Latitude")).toHaveValue(38.5);

    fireEvent.keyDown(tabs().inputs, { key: "ArrowRight" });
    expect(tabs().result).toHaveAttribute("aria-selected", "true");
    expect(tabs().inputs).toHaveAttribute("tabindex", "-1");
    expect(tabs().result).toHaveAttribute("tabindex", "0");
  });
});
