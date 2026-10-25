import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError, type SimulationSummary } from "@/lib/api";
import { RunsView } from "./RunsView";

const { getRocketsMock, getHistoryMock, getSeriesMock, simulateMock } = vi.hoisted(() => ({
  getRocketsMock: vi.fn(),
  getHistoryMock: vi.fn(),
  getSeriesMock: vi.fn(),
  simulateMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    getRockets: (...args: Parameters<typeof actual.getRockets>) => getRocketsMock(...args),
    getHistory: (...args: Parameters<typeof actual.getHistory>) => getHistoryMock(...args),
    getSeries: (...args: Parameters<typeof actual.getSeries>) => getSeriesMock(...args),
    simulate: (...args: Parameters<typeof actual.simulate>) => simulateMock(...args),
  };
});

const ROCKETS = [
  { rocket_id: "r1", name: "Icarus-1", created_at: "2026-01-01T00:00:00Z", created_by: "pilot@multitec.dev" },
  { rocket_id: "r2", name: "Icarus-2", created_at: "2026-02-01T00:00:00Z", created_by: "pilot@multitec.dev" },
];

const SCENARIO = {
  name: "",
  site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
  date: { year: 2026, month: 11, day: 7, hour: 11 },
  atmosphere: { model: "forecast", file: null, station: null, fallback: "standard_atmosphere" },
  rail: { length: 5.2, inclination: 84, heading: 133 },
  uncertainty: null,
};

function run(overrides: Partial<SimulationSummary> & { simulation_id: string }): SimulationSummary {
  return {
    rocket_id: "r2",
    export_id: "exp-1",
    name: "Icarus-2",
    ork_filename: "icarus2.ork",
    created_at: "2026-10-20T10:00:00Z",
    created_by: "pilot@multitec.dev",
    status: "done",
    scenario: SCENARIO,
    scalars: { apogee_m: 3142, max_velocity_ms: 287, flight_time_s: 142, impact_x_m: 1200, impact_y_m: 900 },
    warnings: [],
    result_prefix: "results/x/",
    plot_names: [],
    has_series: true,
    ...overrides,
  };
}

// Newest first, as the API returns them.
const RUNS_R2: SimulationSummary[] = [
  run({ simulation_id: "run-a", created_at: "2026-10-24T12:00:00Z" }),
  run({
    simulation_id: "run-b",
    created_at: "2026-10-23T12:00:00Z",
    scalars: { apogee_m: 3088, max_velocity_ms: 290, flight_time_s: 150, impact_x_m: 1500, impact_y_m: 900 },
    scenario: {
      ...SCENARIO,
      date: { year: 2026, month: 11, day: 7, hour: 15 },
      atmosphere: { ...SCENARIO.atmosphere, model: "standard_atmosphere" },
    },
  }),
  run({ simulation_id: "run-c", created_at: "2026-10-22T12:00:00Z", status: "error", scalars: {} }),
  run({ simulation_id: "run-d", created_at: "2026-10-21T12:00:00Z", export_id: "exp-2", ork_filename: "icarus2_v3.ork" }),
  run({ simulation_id: "run-e", created_at: "2026-10-20T12:00:00Z", export_id: "", ork_filename: null }),
];

const RUNS_R1: SimulationSummary[] = [
  run({ simulation_id: "run-z", rocket_id: "r1", name: "Icarus-1", ork_filename: "icarus1.ork", created_at: "2026-10-25T12:00:00Z" }),
];

function mockSearch(query: string) {
  vi.mocked(useSearchParams).mockReturnValue(
    new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>,
  );
}

function mockApi() {
  getRocketsMock.mockResolvedValue(ROCKETS);
  getHistoryMock.mockImplementation((_limit: number, _before?: string, rocketId?: string | null) => {
    if (rocketId === "r2") return Promise.resolve(RUNS_R2);
    if (rocketId === "r1") return Promise.resolve(RUNS_R1);
    return Promise.resolve([...RUNS_R1, ...RUNS_R2]);
  });
  getSeriesMock.mockImplementation((runId: string) =>
    runId === "run-c"
      ? Promise.reject(new ApiError(404, "no series", { code: "requestFailed" }))
      : Promise.resolve({ t: [0, 1, 2], altitude: [0, 100, 50] }),
  );
}

afterEach(() => {
  getRocketsMock.mockReset();
  getHistoryMock.mockReset();
  getSeriesMock.mockReset();
  simulateMock.mockReset();
  mockSearch("");
});

async function renderRuns(query = "rocket_id=r2") {
  mockApi();
  mockSearch(query);
  render(
    <AppProviders>
      <RunsView />
    </AppProviders>,
  );
  return within(await screen.findByRole("table"));
}

describe("RunsView — rocket selection (S9)", () => {
  it("preselects the rocket named by ?rocket_id= and asks the API for its runs only", async () => {
    await renderRuns("rocket_id=r2");

    const select = screen.getByLabelText("Rocket") as HTMLSelectElement;
    expect(select.value).toBe("r2");
    expect(getHistoryMock).toHaveBeenCalledWith(expect.any(Number), undefined, "r2");
    expect(screen.getAllByRole("link", { name: "View report" }).length).toBeGreaterThan(0);
  });

  it("falls back to the most recent run's rocket when no rocket is named", async () => {
    await renderRuns("");

    const select = screen.getByLabelText("Rocket") as HTMLSelectElement;
    expect(select.value).toBe("r1");
    await waitFor(() => expect(getHistoryMock).toHaveBeenCalledWith(expect.any(Number), undefined, "r1"));
    expect(screen.getByText("icarus1.ork")).toBeInTheDocument();
  });

  it("switching the rocket loads that rocket's runs", async () => {
    await renderRuns("rocket_id=r1");

    fireEvent.change(screen.getByLabelText("Rocket"), { target: { value: "r2" } });

    expect(await screen.findByText("icarus2_v3.ork")).toBeInTheDocument();
  });
});

describe("RunsView — baseline and deltas", () => {
  it("defaults the baseline to the newest finished run and shows signed deltas on the others", async () => {
    const table = await renderRuns();

    expect(table.getByRole("radio", { name: "Baseline: run run-a" })).toBeChecked();
    // run-b: apogee 3088 vs 3142, max speed 290 vs 287, flight time 150 vs 142, landing 1,749 m vs 1,500 m.
    const rowB = table.getByRole("radio", { name: "Baseline: run run-b" }).closest("tr") as HTMLElement;
    expect(within(rowB).getByText("-54 m")).toHaveClass("text-bad-ink");
    expect(within(rowB).getByText("+3 m/s")).toHaveClass("text-ok-ink");
    expect(within(rowB).getByText("+8 s")).toBeInTheDocument();
    expect(within(rowB).getByText("+249 m")).toBeInTheDocument();
    // A failed run has no numbers: dashes, never NaN.
    const rowC = table.getByRole("radio", { name: "Baseline: run run-c" }).closest("tr") as HTMLElement;
    expect(within(rowC).getAllByText("—").length).toBeGreaterThanOrEqual(4);
    expect(within(rowC).getByText("Failed")).toBeInTheDocument();
  });

  it("moving the baseline recomputes the deltas against the new baseline", async () => {
    const table = await renderRuns();

    fireEvent.click(table.getByRole("radio", { name: "Baseline: run run-b" }));

    const rowA = table.getByRole("radio", { name: "Baseline: run run-a" }).closest("tr") as HTMLElement;
    expect(within(rowA).getByText("+54 m")).toHaveClass("text-ok-ink");
  });
});

describe("RunsView — overlay and what changed", () => {
  it("overlays up to three selected runs and disables the fourth checkbox", async () => {
    const table = await renderRuns();

    // The baseline is overlaid from the start.
    expect(table.getByRole("checkbox", { name: "Compare run run-a" })).toBeChecked();
    fireEvent.click(table.getByRole("checkbox", { name: "Compare run run-b" }));
    fireEvent.click(table.getByRole("checkbox", { name: "Compare run run-d" }));

    expect(table.getByRole("checkbox", { name: "Compare run run-c" })).toBeDisabled();
    expect(table.getByRole("checkbox", { name: "Compare run run-b" })).not.toBeDisabled();

    await waitFor(() => {
      expect(getSeriesMock).toHaveBeenCalledWith("run-a");
      expect(getSeriesMock).toHaveBeenCalledWith("run-b");
      expect(getSeriesMock).toHaveBeenCalledWith("run-d");
    });
    const chart = await screen.findByRole("img", { name: /Altitude over time/ });
    expect(chart.querySelectorAll("path[data-run]")).toHaveLength(3);
    const legend = screen.getByRole("list", { name: "Overlaid runs" });
    expect(within(legend).getByText(/icarus2_v3\.ork/)).toBeInTheDocument();
    expect(within(legend).getByText(/run-d/)).toBeInTheDocument();
  });

  it("lists what changed in each compared run against the baseline", async () => {
    const table = await renderRuns();

    fireEvent.click(table.getByRole("checkbox", { name: "Compare run run-b" }));
    fireEvent.click(table.getByRole("checkbox", { name: "Compare run run-d" }));

    const changed = screen.getByRole("region", { name: "What changed" });
    expect(within(changed).getByText(/Weather Real forecast \(GFS\) → Standard atmosphere/)).toBeInTheDocument();
    expect(within(changed).getByText(/Launch .*11:00.* → .*3:00/)).toBeInTheDocument();
    expect(within(changed).getByText("Different file: icarus2_v3.ork")).toBeInTheDocument();
    // The baseline itself is never compared with itself.
    expect(within(changed).queryByText("Same inputs as the baseline")).not.toBeInTheDocument();
  });
});

describe("RunsView — per-run actions (ported from the history list)", () => {
  it("links each finished run to its report", async () => {
    const table = await renderRuns();

    const rowA = table.getByRole("radio", { name: "Baseline: run run-a" }).closest("tr") as HTMLElement;
    expect(within(rowA).getByRole("link", { name: "View report" })).toHaveAttribute("href", "/results/run-a");
    const rowC = table.getByRole("radio", { name: "Baseline: run run-c" }).closest("tr") as HTMLElement;
    expect(within(rowC).queryByRole("link", { name: "View report" })).not.toBeInTheDocument();
  });

  it("re-runs a run with its stored export and scenario, then opens the new result", async () => {
    simulateMock.mockResolvedValueOnce({ run_id: "run-new", scalars: {}, plot_urls: [], warnings: [] });
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() });
    const table = await renderRuns();

    const rowB = table.getByRole("radio", { name: "Baseline: run run-b" }).closest("tr") as HTMLElement;
    fireEvent.click(within(rowB).getByRole("button", { name: /Re-run/ }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/results/run-new"));
    expect(simulateMock).toHaveBeenCalledWith("exp-1", RUNS_R2[1].scenario);
  });

  it("disables re-run for a legacy run without an export and for a failed run, saying why", async () => {
    const table = await renderRuns();

    const rowE = table.getByRole("radio", { name: "Baseline: run run-e" }).closest("tr") as HTMLElement;
    const legacy = within(rowE).getByRole("button", { name: /Re-run/ });
    expect(legacy).toBeDisabled();
    expect(legacy).toHaveAccessibleName(/saved before/);
    const rowC = table.getByRole("radio", { name: "Baseline: run run-c" }).closest("tr") as HTMLElement;
    expect(within(rowC).getByRole("button", { name: /Re-run/ })).toHaveAccessibleName(/failed runs/);
    expect(simulateMock).not.toHaveBeenCalled();
  });
});

describe("RunsView — empty states", () => {
  it("explains when the organization has no rockets yet", async () => {
    getRocketsMock.mockResolvedValue([]);
    getHistoryMock.mockResolvedValue([]);
    mockSearch("");
    render(
      <AppProviders>
        <RunsView />
      </AppProviders>,
    );

    expect(await screen.findByText(/No rockets yet/)).toBeInTheDocument();
  });

  it("explains when the selected rocket has no runs", async () => {
    getRocketsMock.mockResolvedValue(ROCKETS);
    getHistoryMock.mockResolvedValue([]);
    mockSearch("rocket_id=r1");
    render(
      <AppProviders>
        <RunsView />
      </AppProviders>,
    );

    expect(await screen.findByText(/No runs for this rocket yet/)).toBeInTheDocument();
  });
});
