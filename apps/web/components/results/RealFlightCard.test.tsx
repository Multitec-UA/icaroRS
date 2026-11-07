import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ApiError, type FlightComparison, type RealFlightList } from "@/lib/api";
import { RealFlightCard } from "./RealFlightCard";

/**
 * real-flight-compare S6: the "Real flight" card under a run's results.
 * Hidden when the org is not part of the interop; a picker of the published
 * flights; once one is picked, warnings, KPI deltas, RMSE, three overlay
 * charts and the events table.
 */

const api = vi.hoisted(() => ({ getRealFlights: vi.fn(), getFlightComparison: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    getRealFlights: (...args: unknown[]) => api.getRealFlights(...args),
    getFlightComparison: (...args: unknown[]) => api.getFlightComparison(...args),
  };
});

afterEach(() => {
  for (const mock of Object.values(api)) mock.mockReset();
});

const FLIGHTS: RealFlightList = {
  enabled: true,
  flights: [
    {
      flight_id: "MT1-00279-9a1a6300",
      device_id: "mt1-a",
      rocket: "MT1",
      launch_utc: "2026-10-18T10:12:00Z",
      pad: { lat: 41.7299, lon: 0.1042, elev_m: 233 },
      stats: { apogee_m: 459, apogee_t: 10.05, vmax_ms: 95, amax_ms2: 70, landing_t: 120 },
      updated_at: "2026-10-18T12:00:00+00:00",
    },
  ],
};

const COMPARISON: FlightComparison = {
  run_id: "run-1",
  flight_id: "MT1-00279-9a1a6300",
  real_flight: FLIGHTS.flights[0],
  approximate: false,
  series: {
    t: [0, 5, 10, 15, 20],
    sim: { alt_m: [0, 400, 571, 500, 450], vz_ms: [0, 50, 0, -20, -5], acc_ms2: [9.8, 9, 9.8, 108, 9.8] },
    real: { alt_m: [0, 330, 459, 420, null], vz_ms: [0, 40, 0, -15, null], acc_ms2: [9.8, 10, 9.7, 60, null] },
  },
  events: [
    { id: "apogee", label: "Apogee", sim_t: 11.13, real_t: 10.05, delta_t: 1.08, sim_value: 571.4, real_value: 459, delta_value: 112.4, value_unit: "m" },
    { id: "ejection", label: "Ejection", sim_t: null, real_t: 16.06, delta_t: null, sim_value: null, real_value: 410, delta_value: null, value_unit: "m" },
    { id: "deploy", label: "Deploy: Paracaídas", sim_t: 14, real_t: 17.5, delta_t: -3.5, sim_value: 540, real_value: 400, delta_value: 140, value_unit: "m" },
    { id: "rail_exit", label: "Rail exit", sim_t: 0.3, real_t: null, delta_t: null, value_unit: null },
  ],
  kpis: [
    { id: "apogee_m", unit: "m", sim: 571.4, real: 459, delta: 112.4, delta_pct: 24.49 },
    { id: "apogee_t", unit: "s", sim: 11.13, real: 10.05, delta: 1.08, delta_pct: 10.75 },
    { id: "vmax_ms", unit: "m/s", sim: 111.55, real: 95, delta: 16.55, delta_pct: 17.42 },
    { id: "amax_ms2", unit: "m/s²", sim: 108.16, real: 70, delta: 38.16, delta_pct: 54.51 },
    { id: "landing_t", unit: "s", sim: 148.71, real: 120, delta: 28.71, delta_pct: 23.93 },
  ],
  rmse: { alt_m: 74.2, vz_ms: 6.1, acc_ms2: 12.3 },
  window: { t_start: 0, t_end: 15 },
  warnings: [
    { code: "single_deploy", message: "The simulation has one parachute event…" },
    { code: "site_far", message: "far", value: 2235 },
    { code: "brand_new_code", message: "A warning this web does not know yet." },
  ],
  site_distance_m: 2235,
};

function renderCard(units: "metric" | "imperial" = "metric") {
  return render(
    <AppProviders units={units}>
      <RealFlightCard runId="run-1" />
    </AppProviders>,
  );
}

async function pickFlight() {
  const picker = await screen.findByLabelText("Real flight to compare with");
  fireEvent.change(picker, { target: { value: "MT1-00279-9a1a6300" } });
}

describe("RealFlightCard", () => {
  it("renders nothing when the org is not part of the interop", async () => {
    api.getRealFlights.mockResolvedValue({ enabled: false, flights: [] });
    const { container } = renderCard();
    await vi.waitFor(() => expect(api.getRealFlights).toHaveBeenCalled());
    // Let the query settle, then make sure the card never appeared.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("region", { name: "Real flight" })).not.toBeInTheDocument();
    expect(container.querySelector("section")).toBeNull();
  });

  it("explains the empty state when no flight was published", async () => {
    api.getRealFlights.mockResolvedValue({ enabled: true, flights: [] });
    renderCard();
    expect(await screen.findByText(/No real flight has been published yet/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Real flight to compare with")).not.toBeInTheDocument();
  });

  it("lists the flights with rocket, id, launch date and apogee, and compares nothing until one is picked", async () => {
    api.getRealFlights.mockResolvedValue(FLIGHTS);
    renderCard();
    const picker = await screen.findByLabelText("Real flight to compare with");
    expect(within(picker).getByRole("option", { name: /^MT1 · MT1-00279-9a1a6300 · Oct 18, 2026 · 459\sm$/ })).toBeInTheDocument();
    expect(api.getFlightComparison).not.toHaveBeenCalled();
  });

  it("shows warnings, KPI deltas, RMSE, the three overlays and the events once a flight is picked", async () => {
    api.getRealFlights.mockResolvedValue(FLIGHTS);
    api.getFlightComparison.mockResolvedValue(COMPARISON);
    renderCard();
    await pickFlight();

    const kpis = await screen.findByRole("table", { name: "Headline numbers" });
    expect(api.getFlightComparison).toHaveBeenCalledWith("run-1", "MT1-00279-9a1a6300");
    const apogee = within(kpis).getByRole("row", { name: /Apogee/ });
    expect(apogee).toHaveTextContent("571 m");
    expect(apogee).toHaveTextContent("459 m");
    expect(apogee).toHaveTextContent("+112 m (+24.5 %)");
    expect(within(kpis).getByRole("row", { name: /Landing time/ })).toHaveTextContent("+28.7 s");
    expect(screen.getByText(/Typical gap \(RMSE\) from 0 s to 15 s: altitude 74.2 m · vertical speed 6.1 m\/s/)).toBeInTheDocument();

    // Known warnings are translated (the distance in the unit system); unknown ones keep the API message.
    expect(screen.getByText(/opens its parachute in one step/)).toBeInTheDocument();
    expect(screen.getByText(/is 2,235 m from the real pad/)).toBeInTheDocument();
    expect(screen.getByText("A warning this web does not know yet.")).toBeInTheDocument();

    // Three overlays, each with a simulated and a real line and both peaks in its name.
    const charts = screen.getAllByRole("img", { name: /simulated peak .* real peak/ });
    expect(charts).toHaveLength(3);
    expect(charts[0]).toHaveAccessibleName(/^Altitude above the pad: simulated peak 571\sm, real peak 459\sm$/);
    for (const chart of charts) {
      expect(chart.querySelector('path[data-side="sim"]')?.getAttribute("d")).toMatch(/^M/);
      expect(chart.querySelector('path[data-side="real"]')?.getAttribute("d")).toMatch(/^M/);
    }
    // Vertical speed crosses zero: the zero line is drawn.
    expect(charts[1].querySelector("[data-zero-line]")).not.toBeNull();

    const events = screen.getByRole("table", { name: "Flight events" });
    const rows = within(events).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual([
      "Rail exit",
      "Apogee",
      "Ejection",
      "Parachute open",
    ]);
    expect(rows[3]).toHaveTextContent("14 s");
    expect(rows[3]).toHaveTextContent("17.5 s");
    expect(rows[3]).toHaveTextContent("−3.5 s");
    expect(rows[3]).toHaveTextContent("540 m / 400 m");
  });

  it("follows the unit system", async () => {
    api.getRealFlights.mockResolvedValue(FLIGHTS);
    api.getFlightComparison.mockResolvedValue(COMPARISON);
    renderCard("imperial");
    await pickFlight();
    const kpis = await screen.findByRole("table", { name: "Headline numbers" });
    expect(within(kpis).getByRole("row", { name: /^Apogee/ })).toHaveTextContent("1,875 ft");
  });

  it("says when the run has no stored flight data", async () => {
    api.getRealFlights.mockResolvedValue(FLIGHTS);
    api.getFlightComparison.mockRejectedValue(new ApiError(404, "Run 'run-1' has no stored flight series."));
    renderCard();
    await pickFlight();
    expect(await screen.findByText(/This run has no stored flight data to compare/)).toBeInTheDocument();
  });
});
