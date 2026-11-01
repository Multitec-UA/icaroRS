import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { rocketSummaryFromManifest } from "@/lib/domain/rocket";
import { SCALARS } from "@/components/flight/fixtures";
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
