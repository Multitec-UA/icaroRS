import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { AppProviders } from "@/test/test-providers";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { SWEEP } from "./launchDayFixtures";
import { LaunchRailSection } from "./LaunchRailSection";
import { LaunchDayPanel } from "./LaunchDayPanel";

/**
 * launch-day S6b/S7 — the panel against the real API client: one POST to
 * /api/launchday with the active file and scenario (manual wind included),
 * never retried, and Apply to rail writes into the rail inputs.
 */

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
  };
});

const MANIFEST = { flight: { rail_length: 5.2, inclination: 85, heading: 90 } };

function Setup() {
  const { setExport, setSite, setWind } = useWizardDraft();
  useEffect(() => {
    setExport("export-1", MANIFEST);
    setSite({ latitude: 41.734, longitude: 0.1076, elevation: 220 });
    setWind({ speedKmh: 18, directionFrom: 270 });
  }, [setExport, setSite, setWind]);
  return null;
}

async function renderPanel() {
  render(
    <AppProviders>
      <Setup />
      <LaunchRailSection errors={[]} />
      <LaunchDayPanel />
    </AppProviders>,
  );
  const button = await screen.findByRole("button", { name: "Recommend rail setting" });
  // Setup's effects load the file after the first render: a click before
  // that lands on a disabled button and is dropped.
  await waitFor(() => expect(button).toBeEnabled());
  return button;
}

function stubFetch(response: Response) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LaunchDayPanel (launch-day S6b)", () => {
  it("POSTs the active file and the scenario with the measured wind, once", async () => {
    const fetchMock = stubFetch(
      new Response(JSON.stringify(SWEEP), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    fireEvent.click(await renderPanel());
    await screen.findByText("Inclination 86°, heading 240° (SW): lands about 120 m to the NE of the pad.");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0];
    expect(path).toBe("/api/launchday");
    const body = JSON.parse(init.body);
    expect(body.export_id).toBe("export-1");
    expect(body.scenario.wind).toEqual({ speed: 5, direction_from: 270 });
    expect(body).not.toHaveProperty("inclinations");
  });

  it("never retries a failed POST: the sweep would run twice", async () => {
    const failure = new Response("Internal Server Error", { status: 500 });
    failure.headers.delete("Content-Type");
    const fetchMock = stubFetch(failure);
    fireEvent.click(await renderPanel());
    await screen.findByText("Could not reach the server. It may be starting up: try again in a few seconds.", undefined, {
      timeout: 6000,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("Apply to rail writes the best inclination and heading into the rail inputs", async () => {
    stubFetch(new Response(JSON.stringify(SWEEP), { status: 200, headers: { "Content-Type": "application/json" } }));
    fireEvent.click(await renderPanel());
    fireEvent.click(await screen.findByRole("button", { name: "Apply to rail" }));

    expect(screen.getByLabelText("Inclination (°)")).toHaveValue(86);
    expect(screen.getByLabelText("Heading (°)")).toHaveValue(240);
    expect(screen.getAllByText("Overridden")).toHaveLength(2);
  });
});
