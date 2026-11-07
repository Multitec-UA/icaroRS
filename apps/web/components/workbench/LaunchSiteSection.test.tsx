import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { AppProviders } from "@/test/test-providers";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { LaunchSiteSection } from "./LaunchSiteSection";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
  };
});

vi.mock("@/components/map/SitePicker", () => ({ SitePicker: () => <div>site-picker-stub</div> }));

let draft: ReturnType<typeof useWizardDraft> | null = null;

function Probe() {
  const value = useWizardDraft();
  useEffect(() => {
    draft = value;
  });
  return null;
}

async function typeSite(units: "metric" | "imperial", elevationLabel: string, elevation: string) {
  render(
    <AppProviders units={units}>
      <Probe />
      <div data-testid="section">
        <LaunchSiteSection errors={[]} />
      </div>
    </AppProviders>,
  );
  await screen.findByTestId("section");
  fireEvent.change(screen.getByLabelText("Latitude"), { target: { value: "39.3" } });
  fireEvent.change(screen.getByLabelText("Longitude"), { target: { value: "-0.5" } });
  fireEvent.change(screen.getByLabelText(elevationLabel), { target: { value: elevation } });
  return draft?.scenarioBody();
}

describe("LaunchSiteSection — elevation units (units S5)", () => {
  it("metric: elevation in metres, as before", async () => {
    const body = await typeSite("metric", "Elevation (m)", "30.48");
    expect(draft?.state.site?.elevation).toBe(30.48);
    expect(body?.site).toMatchObject({ latitude: 39.3, longitude: -0.5, elevation: 30.48 });
    expect(screen.getByLabelText("Elevation (m)")).toHaveValue(30.48);
  });

  it("imperial: shows and accepts feet, the body still carries metres (100 ft → 30.48 m)", async () => {
    const body = await typeSite("imperial", "Elevation (ft)", "100");
    expect(draft?.state.site?.elevation).toBeCloseTo(30.48, 4);
    expect((body?.site as { elevation: number }).elevation).toBeCloseTo(30.48, 4);
    expect(screen.getByLabelText("Elevation (ft)")).toHaveValue(100);
    // Latitude and longitude are degrees in both systems.
    expect(body?.site).toMatchObject({ latitude: 39.3, longitude: -0.5 });
  });

  it("sends the same SI body as typing the equivalent metres", async () => {
    const imperial = await typeSite("imperial", "Elevation (ft)", "100");
    cleanup();
    const metric = await typeSite("metric", "Elevation (m)", "30.48");
    expect(imperial).toEqual(metric);
  });
});
