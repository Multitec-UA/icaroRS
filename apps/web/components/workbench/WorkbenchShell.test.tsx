import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { useWizard } from "@/components/wizard/WizardProvider";
import { WorkbenchShell } from "./WorkbenchShell";

const { simulateMock, getScenarioTemplateMock, suggestAtmosphereMock, getElevationMock } = vi.hoisted(
  () => ({
    simulateMock: vi.fn(),
    getScenarioTemplateMock: vi.fn(),
    suggestAtmosphereMock: vi.fn(),
    getElevationMock: vi.fn(),
  }),
);

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
    getScenarioTemplate: (...args: Parameters<typeof actual.getScenarioTemplate>) =>
      getScenarioTemplateMock(...args),
    suggestAtmosphere: (...args: Parameters<typeof actual.suggestAtmosphere>) =>
      suggestAtmosphereMock(...args),
    getElevation: (...args: Parameters<typeof actual.getElevation>) => getElevationMock(...args),
  };
});

// Leaflet (SitePicker → MapInner) and three/echarts (InteractiveResults) touch
// `window` at import time and are irrelevant to the shell's wiring under test.
vi.mock("@/components/map/SitePicker", () => ({
  SitePicker: () => <div>site-picker-stub</div>,
}));
vi.mock("@/components/results/InteractiveResultsLazy", () => ({
  InteractiveResultsLazy: ({ runId }: { runId: string }) => <div>interactive-results-stub {runId}</div>,
}));

const TEMPLATE = {
  name: "template",
  site: null,
  date: null,
  atmosphere: { model: "standard_atmosphere", file: null, station: null, fallback: "standard_atmosphere" },
  rail: null,
  uncertainty: null,
  uncertainty_presets: {
    Typical: { mass: { std: 0.02, kind: "relative" } },
    Conservative: { mass: { std: 0.05, kind: "relative" } },
    Precise: { mass: { std: 0.01, kind: "relative" } },
  },
};

const RESULT = {
  run_id: "run-7f3a",
  scalars: { apogee: 3142 },
  plot_urls: [],
  warnings: ["Stability margin at rail exit is low."],
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

afterEach(() => {
  simulateMock.mockReset();
  getScenarioTemplateMock.mockReset();
  suggestAtmosphereMock.mockReset();
  getElevationMock.mockReset();
});

function arm() {
  getScenarioTemplateMock.mockResolvedValue(TEMPLATE);
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
    });
    const run = await seedReady();

    const placeholder = "Results, the 3D replay and plots appear here after the first run.";
    expect(screen.getByText(placeholder)).toBeInTheDocument();
    expect(screen.queryByText(/Up to date/)).toBeNull();

    fireEvent.click(run);

    await waitFor(() =>
      expect(simulateMock).toHaveBeenCalledWith(
        "export-1",
        expect.objectContaining({
          site: { latitude: 38.3452, longitude: -0.481, elevation: 12 },
          atmosphere: expect.objectContaining({ model: "standard_atmosphere" }),
        }),
      ),
    );
    expect(await screen.findByText("interactive-results-stub run-7f3a")).toBeInTheDocument();
    expect(screen.getByText("Stability margin at rail exit is low.")).toBeInTheDocument();
    expect(screen.queryByText(placeholder)).toBeNull();
    expect(push).not.toHaveBeenCalled();
  });

  it("shows 'Up to date' after a run and 'Results are from …' once another export is active", async () => {
    arm();
    simulateMock.mockResolvedValueOnce(RESULT);
    const run = await seedReady();

    fireEvent.click(run);

    expect(await screen.findByText("Up to date · run run-7f3a")).toBeInTheDocument();

    fireEvent.click(screen.getByText("seed-export-2"));

    expect(await screen.findByText("Results are from icarus2.ork · run run-7f3a")).toBeInTheDocument();
    expect(screen.queryByText("Up to date · run run-7f3a")).toBeNull();
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

describe("WorkbenchShell — top bar context", () => {
  it("names the active rocket and file, or says no rocket is selected", async () => {
    arm();
    await renderShell();
    expect(screen.getByText("No rocket selected")).toBeInTheDocument();

    fireEvent.click(screen.getByText("seed-export"));

    expect(await screen.findByText("Icarus-2 · icarus2.ork")).toBeInTheDocument();
  });
});
