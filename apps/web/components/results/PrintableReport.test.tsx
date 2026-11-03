import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { SCALARS } from "@/components/flight/fixtures";
import { PrintableReport, usePrintReport } from "./PrintableReport";

const { getRunSummaryMock, getExportMock } = vi.hoisted(() => ({
  getRunSummaryMock: vi.fn(),
  getExportMock: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    getRunSummary: (...args: Parameters<typeof actual.getRunSummary>) => getRunSummaryMock(...args),
    getExport: (...args: Parameters<typeof actual.getExport>) => getExportMock(...args),
  };
});

const SUMMARY = {
  simulation_id: "20261024T123200Z-run1",
  rocket_id: "r2",
  export_id: "exp-1",
  name: "Icarus-2",
  ork_filename: "icarus2.ork",
  created_at: "2026-10-24T12:32:00Z",
  created_by: "pilot@multitec.dev",
  status: "done" as const,
  scenario: {
    name: "my_scenario",
    site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
    date: { year: 2026, month: 11, day: 7, hour: 11 },
    atmosphere: { model: "forecast", file: null, station: null, fallback: "standard_atmosphere" },
    rail: { length: 5.2, inclination: 84, heading: 133 },
    uncertainty: null,
  },
  scalars: SCALARS,
  warnings: [],
  result_prefix: "results/run-1/",
  plot_names: [],
  has_series: false,
};

const RESULT = {
  scalars: SCALARS,
  warnings: ["Stability margin at rail exit is low."],
  plot_urls: ["/api/results/run-1/plots/trajectory_3d.png", "/api/results/run-1/plots/energy.png"],
};

function PrintButton() {
  const { print, preparing } = usePrintReport();
  return (
    <button type="button" onClick={print} disabled={preparing}>
      {preparing ? "preparing" : "Download PDF"}
    </button>
  );
}

function renderPrintable() {
  return render(
    <AppProviders>
      <PrintableReport runId="20261024T123200Z-run1" result={RESULT}>
        <PrintButton />
      </PrintableReport>
    </AppProviders>,
  );
}

/** The print document is aria-hidden on screen; query it directly. */
function documentRoot(): HTMLElement {
  const root = document.querySelector<HTMLElement>("[data-print-report]");
  if (!root) throw new Error("print document not mounted");
  return root;
}

function loadAllImages() {
  for (const img of Array.from(documentRoot().querySelectorAll("img"))) fireEvent.load(img);
}

let printSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getRunSummaryMock.mockResolvedValue(SUMMARY);
  getExportMock.mockResolvedValue({
    export_id: "exp-1",
    rocket_id: "r2",
    ork_filename: "icarus2.ork",
    manifest: {
      id: { rocket_name: "Icarus-2" },
      rocket: { mass: 9.5, radius: 0.05 },
      stored_results: { max_altitude: 1790, max_velocity: 279, flight_time: 142, simulation_name: "Simulation 1" },
    },
  });
  printSpy = vi.fn();
  window.print = printSpy as unknown as typeof window.print;
});

afterEach(() => {
  getRunSummaryMock.mockReset();
  getExportMock.mockReset();
});

describe("PrintableReport — Download PDF", () => {
  it("mounts nothing printable until asked, and its wrapper never changes the screen layout", async () => {
    renderPrintable();
    const button = await screen.findByRole("button", { name: "Download PDF" });
    expect(document.querySelector("[data-print-report]")).toBeNull();
    expect(button.parentElement).toHaveClass("contents");
  });

  it("prints only once the document is complete: data in, every figure loaded", async () => {
    renderPrintable();
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));

    expect(await screen.findByRole("button", { name: "preparing" })).toBeDisabled();
    await waitFor(() => expect(documentRoot().querySelectorAll("img")).toHaveLength(2));
    expect(printSpy).not.toHaveBeenCalled();

    act(() => loadAllImages());

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Download PDF" })).toBeEnabled();
  });

  it("Ctrl+P (beforeprint) mounts the document as well", async () => {
    renderPrintable();
    await screen.findByRole("button", { name: "Download PDF" });
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    await waitFor(() => expect(document.querySelector("[data-print-report]")).not.toBeNull());
    expect(printSpy).not.toHaveBeenCalled();
  });
});

describe("PrintReport — a formal technical document with everything expanded", () => {
  async function openDocument() {
    renderPrintable();
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    // Both the run summary and the export's manifest have arrived.
    await waitFor(() => expect(within(documentRoot()).getByText(/simulation stored in the file/)).toBeInTheDocument());
    return within(documentRoot());
  }

  it("is hidden on screen and shown only in print, in the light palette", async () => {
    await openDocument();
    expect(documentRoot()).toHaveClass("hidden", "print:block", "palette-light");
  });

  it("opens with the title block: rocket, full run id, author, file and dates in UTC", async () => {
    const doc = await openDocument();
    expect(doc.getByRole("heading", { level: 1 })).toHaveTextContent("Flight simulation report");
    expect(doc.getByText("20261024T123200Z-run1")).toBeInTheDocument();
    expect(doc.getByText("pilot@multitec.dev")).toBeInTheDocument();
    expect(doc.getByText("icarus2.ork")).toBeInTheDocument();
    expect(doc.getByText("Oct 24, 2026, 12:32 PM UTC")).toBeInTheDocument();
  });

  it("numbers the six sections, every one expanded (nothing behind a disclosure)", async () => {
    const doc = await openDocument();
    const headings = doc.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      "1. Summary",
      "2. Configuration",
      "3. Warnings",
      "4. Flight events",
      "5. Complete results",
      "6. Figures",
    ]);
    expect(documentRoot().querySelector("details")).toBeNull();
  });

  it("compares the summary with OpenRocket's stored simulation, unit in its own column", async () => {
    const doc = await openDocument();
    const summary = doc.getByRole("table", { name: "1. Summary" });
    const apogee = within(summary).getByRole("row", { name: /^Highest point above ground/ });
    // icaro 3,142.2 m · OpenRocket 1,790 m · difference +1,352 m (the row's precision: whole metres)
    expect(within(apogee).getAllByRole("cell").map((c) => c.textContent)).toEqual(["m", "3,142", "1,790", "+1,352"]);
    // The difference keeps its row's precision: 287.4 vs 279 → "+8", never "+8.4".
    const speed = within(summary).getByRole("row", { name: /^Maximum speed/ });
    expect(within(speed).getAllByRole("cell").map((c) => c.textContent)).toEqual(["m/s", "287", "279", "+8"]);
    expect(doc.getByText(/simulation stored in the file \(Simulation 1\)/)).toBeInTheDocument();
  });

  it("states the launch conditions, the warnings and every scalar", async () => {
    const doc = await openDocument();
    const launch = doc.getByRole("table", { name: "Launch conditions" });
    expect(within(launch).getByRole("row", { name: /^Latitude/ })).toHaveTextContent("38.3452");
    expect(within(launch).getByRole("row", { name: /^Rail length/ })).toHaveTextContent("5.2");
    expect(doc.getByText("Stability margin at rail exit is low.")).toBeInTheDocument();
    const results = doc.getByRole("table", { name: "5. Complete results" });
    expect(within(results).getByRole("row", { name: /^Highest point above ground/ })).toHaveTextContent("3,142");
  });

  it("numbers every figure, loads it eagerly and names it from the plot catalog", async () => {
    const doc = await openDocument();
    const images = Array.from(documentRoot().querySelectorAll("img"));
    expect(images.map((img) => img.getAttribute("loading"))).toEqual(["eager", "eager"]);
    expect(doc.getByText("Figure 1. 3D trajectory")).toBeInTheDocument();
    expect(doc.getByText("Figure 2. Energy")).toBeInTheDocument();
  });
});
