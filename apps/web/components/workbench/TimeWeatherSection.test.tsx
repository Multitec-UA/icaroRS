import { describe, expect, it, vi } from "vitest";
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

  it("exposes the fallback the API accepts, with its warning note", async () => {
    await renderSection();
    const select = screen.getByLabelText("If the forecast is unavailable");
    expect(select).toHaveValue("standard_atmosphere");
    const options = Array.from((select as HTMLSelectElement).options).map((o) => [o.value, o.text]);
    expect(options).toEqual([["standard_atmosphere", "Use the standard atmosphere"]]);
    expect(screen.getByText("A fallback is always reported as a warning on the result.")).toBeInTheDocument();
    expect(draft?.scenarioBody().atmosphere).toMatchObject({ fallback: "standard_atmosphere" });
  });
});
