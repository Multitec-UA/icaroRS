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

describe("MonteCarloCard (S15) — explaining a finished run", () => {
  const done = (patch: Partial<NonNullable<typeof MC_DONE.result>>) => ({ ...MC_DONE, result: { ...MC_DONE.result!, ...patch } });

  it("says what was varied, from the run's own uncertainty budget", () => {
    wrap(<MonteCarloCard runId="mc-1" run={MC_DONE} loading={false} error={null} onDismiss={() => {}} />);
    expect(
      screen.getByText(
        "We simulated 100 flights, each time slightly changing the mass (±5 %), thrust (±3 %), wind (±10 %), launch angle and heading (±2°), and rail length (±5 %). This shows how much a real flight can differ from the single simulation.",
      ),
    ).toBeInTheDocument();
  });

  it("an older run without a budget says it used the default one", () => {
    wrap(<MonteCarloCard runId="mc-1" run={done({ uncertainty: {} })} loading={false} error={null} onDismiss={() => {}} />);
    expect(
      screen.getByText(
        "We simulated 100 flights with the default uncertainty budget. This shows how much a real flight can differ from the single simulation.",
      ),
    ).toBeInTheDocument();
  });

  it("reads the run: apogee range, most likely landing point, failed flights", () => {
    wrap(<MonteCarloCard runId="mc-1" run={MC_DONE} loading={false} error={null} onDismiss={() => {}} />);
    expect(screen.getByText("9 out of 10 flights reached between 720 m and 850 m (median 795 m).")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The most likely landing point is about 120 m to the east of the launch site; 99 % of landings fall inside the outer ellipse.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("3 flights could not be simulated and are not counted.")).toBeInTheDocument();
  });

  it("one failed flight reads in the singular; none adds no clause", () => {
    const { unmount } = wrap(
      <MonteCarloCard runId="mc-1" run={done({ n_failed: 1 })} loading={false} error={null} onDismiss={() => {}} />,
    );
    expect(screen.getByText("1 flight could not be simulated and is not counted.")).toBeInTheDocument();
    unmount();
    wrap(<MonteCarloCard runId="mc-1" run={done({ n_failed: 0 })} loading={false} error={null} onDismiss={() => {}} />);
    expect(screen.queryByText(/could not be simulated/)).toBeNull();
  });

  it("without a successful flight only says so", () => {
    wrap(
      <MonteCarloCard
        runId="mc-1"
        run={done({ apogee_stats: null, apogee_agl: [], impact_x: [], impact_y: [], n_succeeded: 0, n_failed: 100 })}
        loading={false}
        error={null}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByText("No flight could be simulated, so there is nothing to read yet.")).toBeInTheDocument();
    expect(screen.queryByText(/out of 10 flights/)).toBeNull();
    expect(screen.queryByText(/most likely landing point/)).toBeNull();
    expect(screen.queryByText(/could not be simulated and are not counted/)).toBeNull();
  });

  it("has a tooltip on the counts, apogee, histogram and ellipses blocks", () => {
    wrap(<MonteCarloCard runId="mc-1" run={MC_DONE} loading={false} error={null} onDismiss={() => {}} />);
    const tips = screen.getAllByRole("button", { name: "More information" });
    expect(tips).toHaveLength(4);
    const texts = tips.map((tip) => {
      fireEvent.click(tip);
      const text = document.getElementById(tip.getAttribute("aria-controls")!)?.textContent;
      fireEvent.click(tip);
      return text;
    });
    expect(texts[0]).toMatch(/Attempted.*Succeeded.*Failed/);
    expect(texts[1]).toMatch(/Mean ± std/);
    expect(texts[1]).toMatch(/90 %/);
    expect(texts[2]).toMatch(/Each bar counts the flights/);
    expect(texts[3]).toMatch(/39 %.*86 %.*99 %/);
    expect(texts[3]).toMatch(/launch site/);
    expect(texts[3]).toMatch(/not from a real wind forecast/);
  });

  it("offers a collapsed 'How to read these results' explanation", () => {
    wrap(<MonteCarloCard runId="mc-1" run={MC_DONE} loading={false} error={null} onDismiss={() => {}} />);
    expect(screen.getByText("How to read these results").closest("details")).not.toHaveAttribute("open");
  });
});
