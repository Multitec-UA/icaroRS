import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { AppProviders } from "@/test/test-providers";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { TimeWeatherSection } from "./TimeWeatherSection";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
    // No suggestion: the model stays whatever the test picks.
    suggestAtmosphere: vi.fn().mockRejectedValue(new Error("offline")),
  };
});

let draft: ReturnType<typeof useWizardDraft> | null = null;

function Probe() {
  const value = useWizardDraft();
  useEffect(() => {
    draft = value;
  });
  return null;
}

async function renderSection(units: "metric" | "imperial" = "metric") {
  render(
    <AppProviders units={units}>
      <Probe />
      <div data-testid="section">
        <TimeWeatherSection errors={[]} />
      </div>
    </AppProviders>,
  );
  await screen.findByTestId("section");
}

describe("TimeWeatherSection (S4)", () => {
  it("offers forecast, sounding and standard atmosphere only — no reanalysis", async () => {
    await renderSection();
    expect(screen.getByRole("button", { name: "Forecast" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Standard" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sounding" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ERA5" })).toBeNull();
    expect(screen.queryByLabelText("ERA5 file path")).toBeNull();
  });

  it("still sets the atmosphere model from the segmented control", async () => {
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Sounding" }));
    expect(draft?.state.atmosphere.model).toBe("wyoming_sounding");
    expect(screen.getByLabelText("Station id")).toBeInTheDocument();
  });

  it("states the only fallback the API accepts as a sentence, not a one-option select (S12c)", async () => {
    await renderSection();
    expect(
      screen.getByText("If the forecast is unavailable, the standard atmosphere is used and the run says so."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(draft?.scenarioBody().atmosphere).toMatchObject({ fallback: "standard_atmosphere" });
  });
});

describe("TimeWeatherSection — forecast window notice (S12e)", () => {
  const NOTICE = "Outside the forecast window: the run will fall back to the standard atmosphere.";

  afterEach(() => {
    vi.useRealTimers();
  });

  async function renderAt(datetime: string, model: "Forecast" | "Standard" | "Sounding") {
    // The frozen e2e clock: 2026-10-31T10:00:00Z.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-31T10:00:00Z"));
    await renderSection();
    fireEvent.change(screen.getByLabelText(/^Launch · your time/, { selector: "input" }), {
      target: { value: datetime },
    });
    fireEvent.click(screen.getByRole("button", { name: model }));
  }

  it("warns under the date when a forecast launch is more than 16 days ahead", async () => {
    await renderAt("2026-11-20T11:00", "Forecast");
    const notice = screen.getByText(NOTICE);
    expect(notice).toHaveClass("text-warn-ink");
  });

  it("warns when a forecast launch is in the past", async () => {
    await renderAt("2026-10-29T11:00", "Forecast");
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
  });

  it("says nothing inside the window, or with the standard atmosphere or a sounding", async () => {
    await renderAt("2026-11-07T11:00", "Forecast");
    expect(screen.queryByText(NOTICE)).toBeNull();

    fireEvent.change(screen.getByLabelText(/^Launch · your time/, { selector: "input" }), {
      target: { value: "2026-11-20T11:00" },
    });
    expect(screen.getByText(NOTICE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Standard" }));
    expect(screen.queryByText(NOTICE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sounding" }));
    expect(screen.queryByText(NOTICE)).toBeNull();
  });
});

describe("TimeWeatherSection — wind on the pad (launch-day S6a)", () => {
  it("uses the forecast by default: no wind inputs and no wind in the body", async () => {
    await renderSection();
    expect(screen.getByRole("button", { name: "Forecast wind" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByLabelText("Speed (km/h)")).toBeNull();
    expect(draft?.scenarioBody()).not.toHaveProperty("wind");
  });

  it("sends the measured wind in m/s once the switch is on, and drops it when switched back", async () => {
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Measured on the pad" }));
    fireEvent.change(screen.getByLabelText("Speed (km/h)"), { target: { value: "18" } });
    fireEvent.change(screen.getByLabelText("From (°)"), { target: { value: "270" } });

    expect(screen.getByText("270° = from the west")).toBeInTheDocument();
    expect(draft?.scenarioBody().wind).toEqual({ speed: 5, direction_from: 270 });

    fireEvent.click(screen.getByRole("button", { name: "Forecast wind" }));
    expect(screen.queryByLabelText("Speed (km/h)")).toBeNull();
    expect(draft?.scenarioBody()).not.toHaveProperty("wind");
  });

  it("clamps the speed to 0–60 km/h and the direction to 0–359° when leaving the field", async () => {
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Measured on the pad" }));
    // The section re-renders on every draft change: query the inputs afresh.
    const speed = () => screen.getByLabelText("Speed (km/h)");
    const direction = () => screen.getByLabelText("From (°)");
    fireEvent.change(speed(), { target: { value: "90" } });
    fireEvent.blur(speed());
    fireEvent.change(direction(), { target: { value: "400" } });
    fireEvent.blur(direction());

    expect(speed()).toHaveValue(60);
    expect(direction()).toHaveValue(359);
    expect(draft?.state.wind).toEqual({ speedKmh: 60, directionFrom: 359 });
  });
});

describe("TimeWeatherSection — wind in imperial units (units S5)", () => {
  async function windBody(units: "metric" | "imperial", label: string, value: string) {
    await renderSection(units);
    fireEvent.click(screen.getByRole("button", { name: "Measured on the pad" }));
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.change(screen.getByLabelText("From (°)"), { target: { value: "270" } });
    return draft?.scenarioBody();
  }

  it("shows and accepts mph, and the body still carries m/s", async () => {
    const body = await windBody("imperial", "Speed (mph)", "20");
    expect(screen.getByText("0–37 mph, as read on the anemometer")).toBeInTheDocument();
    const wind = body?.wind as { speed: number; direction_from: number };
    expect(wind.speed).toBeCloseTo(8.94, 2);
    expect(wind.direction_from).toBe(270);
    // The draft stays in km/h whatever the display unit.
    expect(draft?.state.wind?.speedKmh).toBeCloseTo(32.187, 3);
    fireEvent.blur(screen.getByLabelText("Speed (mph)"));
    expect(screen.getByLabelText("Speed (mph)")).toHaveValue(20);
  });

  it("sends the same SI body as typing the equivalent km/h", async () => {
    const imperial = await windBody("imperial", "Speed (mph)", "20");
    cleanup();
    const metric = await windBody("metric", "Speed (km/h)", "32.18688");
    expect(imperial).toEqual(metric);
  });

  it("clamps to the same 60 km/h limit when typed in mph", async () => {
    await renderSection("imperial");
    fireEvent.click(screen.getByRole("button", { name: "Measured on the pad" }));
    fireEvent.change(screen.getByLabelText("Speed (mph)"), { target: { value: "90" } });
    fireEvent.blur(screen.getByLabelText("Speed (mph)"));
    expect(draft?.state.wind?.speedKmh).toBe(60);
    expect(screen.getByLabelText("Speed (mph)")).toHaveValue(37.28);
  });
});
