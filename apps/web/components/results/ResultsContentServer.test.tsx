import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { makeT } from "@/lib/i18n";
import { SCALARS } from "@/components/flight/fixtures";
import { ResultsContentServer } from "./ResultsContentServer";

const { getRunSummaryMock, getSeriesMock, getExportMock } = vi.hoisted(() => ({
  getRunSummaryMock: vi.fn(),
  getSeriesMock: vi.fn(),
  getExportMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    getRunSummary: (...args: Parameters<typeof actual.getRunSummary>) => getRunSummaryMock(...args),
    getSeries: (...args: Parameters<typeof actual.getSeries>) => getSeriesMock(...args),
    getExport: (...args: Parameters<typeof actual.getExport>) => getExportMock(...args),
  };
});

vi.mock("@/lib/server-api", () => ({
  getResultServer: vi.fn().mockResolvedValue({
    run_id: "run-1",
    status: "done",
    result: {
      run_id: "run-1",
      scalars: SCALARS,
      warnings: ["Stability margin at rail exit is low."],
      plot_urls: ["/api/results/run-1/plots/energy.png"],
    },
  }),
}));

// three.js needs a canvas jsdom does not provide; the replay's own tests cover it.
vi.mock("@/components/charts/Trajectory3D", () => ({
  Trajectory3D: () => <div>trajectory-3d-stub</div>,
}));

// The global motion stub never ticks `animate`, so CountUp would sit at 0;
// the flight stub jumps straight to the settled value the KPIs assert on.
vi.mock("motion/react", async () => (await import("@/components/flight/testMotionStub")).makeMotionStub({ reduce: false }));

const SUMMARY = {
  simulation_id: "run-1",
  rocket_id: "r2",
  export_id: "exp-1",
  name: "Icarus-2",
  ork_filename: "icarus2.ork",
  created_at: "2026-10-24T12:32:00Z",
  created_by: "pilot@multitec.dev",
  status: "done" as const,
  scenario: {
    name: "",
    site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
    date: { year: 2026, month: 11, day: 7, hour: 11 },
    atmosphere: { model: "forecast", file: null, station: null, fallback: "standard_atmosphere" },
    rail: { length: 5.2, inclination: 84, heading: 133 },
    uncertainty: null,
  },
  scalars: { ...SCALARS, apogee: SCALARS.apogee_m },
  warnings: [],
  result_prefix: "results/run-1/",
  plot_names: ["energy.png"],
  has_series: false,
};

// Vitest cannot render an async Server Component directly (see
// vitest.config.ts); awaiting it yields the plain element tree, whose client
// islands then render under the usual provider stack.
async function renderReport() {
  getRunSummaryMock.mockResolvedValue(SUMMARY);
  getSeriesMock.mockRejectedValue(new ApiError(404, "Run 'run-1' has no series.", { code: "requestFailed" }));
  getExportMock.mockResolvedValue({
    export_id: "exp-1",
    rocket_id: "r2",
    ork_filename: "icarus2.ork",
    manifest: {
      id: { rocket_name: "Icarus-2" },
      rocket: { mass: 9.5, radius: 0.05 },
      stored_results: { max_altitude: 1790, max_velocity: 279, flight_time: 142 },
    },
  });
  const tree = await ResultsContentServer({ runId: "run-1", t: makeT("en"), locale: "en" });
  return render(<AppProviders>{tree}</AppProviders>);
}

describe("Run report (S9, board C) — header", () => {
  it("builds the breadcrumb and the title from the run's rocket and site", async () => {
    await renderReport();

    const crumbs = await screen.findByRole("navigation", { name: "Breadcrumb" });
    // The rocket crumb arrives with the run's history row.
    expect(await within(crumbs).findByRole("link", { name: "Icarus-2" })).toHaveAttribute("href", "/runs?rocket_id=r2");
    expect(within(crumbs).getByRole("link", { name: "Runs" })).toHaveAttribute("href", "/runs");
    expect(within(crumbs).getByText("run run-1")).toHaveAttribute("aria-current", "page");

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Icarus-2 over 38.3452, -0.481");
    // The file name shows in the subtitle and again in the configuration list.
    const files = screen.getAllByText("icarus2.ork");
    expect(files.length).toBeGreaterThanOrEqual(1);
    files.forEach((file) => expect(file).toHaveAttribute("translate", "no"));
    expect(screen.getByText(/Oct 24, 2026/)).toBeInTheDocument();
    expect(screen.getByText("pilot@multitec.dev")).toHaveAttribute("translate", "no");
  });
});

describe("Run report — body", () => {
  it("shows the four KPIs, the warnings, every scalar and the configuration side by side", async () => {
    await renderReport();

    // Once the series query settled (404 here) the replay skeleton's own
    // status region is gone and the warnings banner is the only one left.
    await screen.findByText(/no flight data to replay/);
    const kpis = screen.getByRole("region", { name: "Key results" });
    expect(within(kpis).getByRole("group", { name: "Apogee" })).toHaveTextContent("3,142");
    expect(screen.getByRole("status")).toHaveTextContent("Stability margin at rail exit is low.");

    const all = screen.getByRole("region", { name: "All results" });
    expect(within(all).getByText("Time to apogee").nextElementSibling).toHaveTextContent("21.8 s");
    expect(within(all).getByText("Maximum Mach number").nextElementSibling).toHaveTextContent("0.84");

    const config = await screen.findByRole("region", { name: "Configuration" });
    expect(within(config).getByText("Rocket file").nextElementSibling).toHaveTextContent("icarus2.ork");
    expect(within(config).getByText("Weather").nextElementSibling).toHaveTextContent("Real forecast (GFS)");
    expect(within(config).getByText("Rail").nextElementSibling).toHaveTextContent("5.2 m · 84° · 133°");
  });

  it("keeps the PNG plots under Plots, mounted when opened, when the run has no series (404)", async () => {
    await renderReport();

    expect(await screen.findByText(/no flight data to replay/)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "Energy" })).toBeNull();
    fireEvent.click(screen.getByText("Plots"));
    expect(await screen.findByRole("img", { name: "Energy" })).toBeInTheDocument();
    expect(getSeriesMock).toHaveBeenCalledWith("run-1");
  });

  it("renders the shared results composition: the OpenRocket row from the run's export and the rocket card", async () => {
    await renderReport();

    const row = await screen.findByTestId("openrocket-row");
    expect(row).toHaveTextContent("OpenRocket, its own conditions saved in the file:");
    expect(row).toHaveTextContent("apogee 1,790 m");
    expect(row).toHaveTextContent("flight time 142 s");
    expect(getExportMock).toHaveBeenCalledWith("exp-1");
    const config = screen.getByRole("region", { name: "Configuration" });
    expect(await within(config).findByRole("group", { name: /Icarus-2/ })).toBeInTheDocument();
  });

  it("keeps the actions reachable", async () => {
    await renderReport();

    expect(await screen.findByRole("link", { name: "Simulate again" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("button", { name: "New rocket" })).toBeInTheDocument();
  });
});
