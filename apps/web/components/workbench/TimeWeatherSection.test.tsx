import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

async function renderSection() {
  render(
    <AppProviders>
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
