import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { rocketSummaryFromManifest } from "@/lib/domain/rocket";
import { SCALARS, WIND_SCALARS } from "@/components/flight/fixtures";
import { ReplayProvider } from "@/components/flight/ReplayContext";
import { RunResults, type RunResultsProps } from "./RunResults";

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
}));

vi.mock("@/components/charts/Trajectory3D", () => ({
  Trajectory3D: () => <div>trajectory-3d-stub</div>,
}));
vi.mock("@/components/charts/SeriesChart", () => ({
  SeriesChart: () => <div>series-chart-stub</div>,
}));

const PLOTS = ["trajectory_3d", "energy", "linear_kinematics"].map((stem) => `/api/results/run-1/plots/${stem}.png`);
const NO_SERIES: RunResultsProps["series"] = {
  data: undefined,
  error: new ApiError(404, "no series"),
  isError: true,
  isPending: false,
};

/** AppProviders resolves the session first; resolves once the results are on screen. */
async function renderResults(overrides: Partial<RunResultsProps> = {}) {
  const view = render(
    <AppProviders>
      <ReplayProvider>
        <RunResults
          runId="run-1"
          result={{ scalars: SCALARS, warnings: [], plot_urls: PLOTS }}
          exportSummary={null}
          series={NO_SERIES}
          {...overrides}
        />
      </ReplayProvider>
    </AppProviders>,
  );
  await screen.findByRole("region", { name: "Key results" });
  return view;
}

describe("RunResults (S7) — the OpenRocket comparison row", () => {
  it("shows one row with OpenRocket's stored results when the file has them", async () => {
    await renderResults({
      exportSummary: rocketSummaryFromManifest({
        stored_results: { max_altitude: 1790, max_velocity: 279, flight_time: 142 },
      }),
    });

    const row = screen.getByTestId("openrocket-row");
    expect(row).toHaveTextContent(
      "OpenRocket, its own conditions saved in the file: apogee 1,790 m · max speed 279 m/s · flight time 142 s",
    );
  });

  it("labels the row with the simulation name, and marks it outdated only when it is", async () => {
    const summaryWith = (status: string | null) =>
      rocketSummaryFromManifest({
        stored_results: { max_altitude: 1790, max_velocity: 279, flight_time: 142, simulation_name: "Simulation 1", status },
      });
    const values = "apogee 1,790 m · max speed 279 m/s · flight time 142 s";

    const { unmount } = await renderResults({ exportSummary: summaryWith("outdated") });
    const row = screen.getByTestId("openrocket-row");
    expect(row).toHaveTextContent(`OpenRocket · Simulation 1 · outdated: ${values}`);
    expect(within(row).getByText("outdated")).toHaveClass("text-warn-ink");
    // Never a difference or a percentage against RocketPy.
    expect(row.textContent).not.toMatch(/%|Δ|diff/i);
    unmount();

    for (const status of ["uptodate", "loaded", null]) {
      const view = await renderResults({ exportSummary: summaryWith(status) });
      const plain = screen.getByTestId("openrocket-row");
      expect(plain).toHaveTextContent(`OpenRocket · Simulation 1: ${values}`);
      expect(plain).not.toHaveTextContent("outdated");
      view.unmount();
    }
  });

  it("is absent without stored results (zeros mean missing) or without an export summary", async () => {
    const { unmount } = await renderResults({
      exportSummary: rocketSummaryFromManifest({ stored_results: { max_altitude: 0, max_velocity: 0, flight_time: 0 } }),
    });
    expect(screen.queryByTestId("openrocket-row")).toBeNull();
    unmount();

    await renderResults({ exportSummary: null });
    expect(screen.queryByTestId("openrocket-row")).toBeNull();
  });
});

describe("RunResults (S7) — the two disclosures", () => {
  it("lists every scalar under 'All results (16 values)'", async () => {
    await renderResults();

    expect(screen.getByText("All results")).toBeInTheDocument();
    expect(screen.getByText("All results").closest("summary")).toHaveTextContent("All results (16 values)");
    expect(screen.getByRole("region", { name: "All results" })).toHaveTextContent("Maximum Mach number");
  });

  it("lists both rail-exit margins, static and with wind, and the angle of attack when the run has them", async () => {
    await renderResults({ result: { scalars: WIND_SCALARS, warnings: [], plot_urls: PLOTS } });

    expect(screen.getByText("All results").closest("summary")).toHaveTextContent("All results (18 values)");
    const all = screen.getByRole("region", { name: "All results" });
    expect(all).toHaveTextContent("Rail departure stability margin1.93 cal");
    expect(all).toHaveTextContent("Rail departure stability margin (with wind)1.42 cal");
    expect(all).toHaveTextContent("Angle of attack at rail departure6.97 °");
  });

  it("mounts the plot images only once 'Plots' is opened, and keeps them after closing", async () => {
    await renderResults();

    expect(screen.getByText("Plots").closest("summary")).toHaveTextContent("Plots (3)");
    expect(screen.queryByRole("img", { name: "Energy" })).toBeNull();

    const summary = screen.getByText("Plots").closest("summary")!;
    fireEvent.keyDown(summary, { key: "Enter" });
    expect(screen.getByRole("img", { name: "Energy" })).toBeInTheDocument();

    fireEvent.keyDown(summary, { key: "Enter" });
    expect(screen.getByRole("img", { name: "Energy" })).toBeInTheDocument();
  });

  it("opens both disclosures and mounts the plots before printing", async () => {
    await renderResults();
    expect(document.querySelector('img[src$="/trajectory_3d.png"]')).toBeNull();
    fireEvent(window, new Event("beforeprint"));

    // The handler sets state; under load (CI) the re-render lands a tick later.
    await waitFor(() => {
      document.querySelectorAll("details").forEach((details) => expect(details.open).toBe(true));
    });
    expect(await screen.findByRole("img", { name: "Energy" })).toBeInTheDocument();
    // The replay's print stand-in: the trajectory PNG, mounted only for print.
    await waitFor(() => {
      expect(document.querySelector('img[src$="/trajectory_3d.png"].print\\:block')).not.toBeNull();
    });
  });
});

describe("RunResults (S7) — replay states", () => {
  it("says the run has no series on a 404 and keeps the KPIs and the timeline", async () => {
    await renderResults();

    expect(screen.getByText(/no flight data to replay/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Key results" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Flight timeline" })).toBeInTheDocument();
  });
});

describe("RunResults — imperial units", () => {
  it("shows the OpenRocket row and every length/speed scalar in ft and ft/s", async () => {
    render(
      <AppProviders units="imperial">
        <ReplayProvider>
          <RunResults
            runId="run-1"
            result={{ scalars: SCALARS, warnings: [], plot_urls: PLOTS }}
            exportSummary={rocketSummaryFromManifest({
              stored_results: { max_altitude: 1790, max_velocity: 279, flight_time: 142 },
            })}
            series={NO_SERIES}
          />
        </ReplayProvider>
      </AppProviders>,
    );
    await screen.findByRole("region", { name: "Key results" });

    expect(screen.getByTestId("openrocket-row")).toHaveTextContent(
      "apogee 5,873 ft · max speed 915 ft/s · flight time 142 s",
    );
    const all = screen.getByRole("region", { name: "All results" });
    expect(all).toHaveTextContent("10,309 ft");
    expect(all).toHaveTextContent("943 ft/s");
    expect(all).toHaveTextContent("313 ft/s²");
    expect(all).toHaveTextContent("1.93 cal");
    expect(all).not.toHaveTextContent(/\d m\b/);
  });
});
