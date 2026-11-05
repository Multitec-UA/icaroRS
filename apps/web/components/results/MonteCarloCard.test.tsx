import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ApiError } from "@/lib/api";
import { MonteCarloCard } from "./MonteCarloCard";
import { MC_DONE, mcRun as base } from "./monteCarloFixtures";

// Leaflet needs `window` at import time; the map is checked through its props.
vi.mock("@/components/map/LandingEllipseMap", () => ({
  LandingEllipseMap: ({ layers, origin }: { layers: { sigma: number }[]; origin: { latitude: number } }) => (
    <div data-testid="ellipse-map">
      {layers.map((layer) => `${layer.sigma}σ`).join(",")} @ {origin.latitude}
    </div>
  ),
}));

function wrap(node: ReactNode) {
  return render(<LocaleProvider initialLocale="en">{node}</LocaleProvider>);
}

describe("MonteCarloCard (S12) — the dispersion run's states", () => {
  it("queued behind other runs says how many are ahead", () => {
    wrap(<MonteCarloCard runId="mc-1" run={base({ queue_position: 2 })} loading={false} error={null} onDismiss={() => {}} />);
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(screen.getByText("Waiting behind 2 runs")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("queued at the head of the queue says it starts shortly", () => {
    wrap(<MonteCarloCard runId="mc-1" run={base({ queue_position: 0 })} loading={false} error={null} onDismiss={() => {}} />);
    expect(screen.getByText("Starting shortly")).toBeInTheDocument();
  });

  it("running shows a progress bar and done / total flights", () => {
    wrap(
      <MonteCarloCard
        runId="mc-1"
        run={base({ status: "running", progress: { done: 42, total: 100 } })}
        loading={false}
        error={null}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("42 / 100 flights")).toBeInTheDocument();
    const bar = screen.getByRole("progressbar", { name: "Dispersion progress" });
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
  });

  it("error shows the API's message", () => {
    wrap(
      <MonteCarloCard
        runId="mc-1"
        run={base({ status: "error", error: "Instance restarted; the job was lost." })}
        loading={false}
        error={null}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Instance restarted; the job was lost.")).toBeInTheDocument();
  });

  it("a run the API no longer has (404) says so", () => {
    wrap(
      <MonteCarloCard runId="mc-x" run={undefined} loading={false} error={new ApiError(404, "nope")} onDismiss={() => {}} />,
    );
    expect(screen.getByText("This dispersion run is no longer available.")).toBeInTheDocument();
  });

  it("can be dismissed", () => {
    const onDismiss = vi.fn();
    wrap(<MonteCarloCard runId="mc-1" run={base({})} loading={false} error={null} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Close dispersion" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("MonteCarloCard (S12) — a finished run's results", () => {
  it("shows counts, apogee stats, the histogram, the ellipse map and the KML link", () => {
    wrap(<MonteCarloCard runId="mc-1" run={MC_DONE} loading={false} error={null} onDismiss={() => {}} />);

    expect(screen.getByText("Done")).toBeInTheDocument();
    const counts = screen.getByRole("list", { name: "Flights" });
    expect(within(counts).getByText("100")).toBeInTheDocument();
    expect(within(counts).getByText("97")).toBeInTheDocument();
    expect(within(counts).getByText("3")).toBeInTheDocument();

    expect(screen.getByText("793 m ± 45.9 m")).toBeInTheDocument();
    expect(screen.getByText("795 m")).toBeInTheDocument();
    const histogram = screen.getByRole("img", { name: "Apogee distribution of 8 flights" });
    expect(histogram.querySelectorAll("rect")).toHaveLength(12);

    expect(screen.getByTestId("ellipse-map")).toHaveTextContent("1σ,2σ,3σ @ 38.2655");
    expect(screen.getByRole("link", { name: "Download KML" })).toHaveAttribute("href", "/api/montecarlo/mc-1/kml");
  });

  it("without a KML (fewer than 3 flights) has no download link and no ellipse", () => {
    const result = { ...MC_DONE.result!, landing_ellipses: [], ellipse_sigmas: [], files: { kml: null } };
    wrap(<MonteCarloCard runId="mc-1" run={{ ...MC_DONE, result }} loading={false} error={null} onDismiss={() => {}} />);
    expect(screen.queryByRole("link", { name: "Download KML" })).toBeNull();
    expect(screen.getByText("Too few successful flights for a landing ellipse.")).toBeInTheDocument();
  });
});
