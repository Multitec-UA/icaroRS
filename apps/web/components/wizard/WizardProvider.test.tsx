import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { mockBrowserTimeZone } from "@/test/mock-time-zone";
import {
  WizardProvider,
  useWizard,
  useWizardDraft,
  useWizardNav,
} from "./WizardProvider";

// Pure domain-rule tests (toLaunchDate, buildScenarioBody, canRun,
// needsDate) live in lib/domain/scenario.test.ts (issue #50) — no rendering
// needed there. This file covers the React wiring: the reducer, the two
// contexts, and the render-isolation the split is for.

const RUN_1 = {
  runId: "run-1",
  exportId: "export-1",
  exportFilename: "icarus2.ork",
  scenario: { name: "my_scenario", uncertainty: {} },
  result: { run_id: "run-1", scalars: {}, plot_urls: [], warnings: [] },
};

function wrapper({ children }: { children: ReactNode }) {
  return <WizardProvider>{children}</WizardProvider>;
}

function setup() {
  return renderHook(() => useWizard(), { wrapper });
}

describe("WizardProvider — export and run readiness", () => {
  it("setExport stores the export's rocket when given, and clears it when not", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", { name: "R" }, "rocket-1"));
    expect(result.current.state.rocketId).toBe("rocket-1");
    expect(result.current.exportId).toBe("export-1");

    act(() => result.current.setExport("export-2", {}));
    expect(result.current.state.exportId).toBe("export-2");
    expect(result.current.state.rocketId).toBeNull();

    act(() => result.current.reset());
    expect(result.current.state.rocketId).toBeNull();
  });

  it("needsDate follows the atmosphere model", () => {
    const { result } = setup();
    expect(result.current.needsDate).toBe(false);
    act(() =>
      result.current.setAtmosphere({ model: "forecast", file: null, station: null, fallback: "standard_atmosphere" }),
    );
    expect(result.current.needsDate).toBe(true);
  });
});

describe("WizardProvider — loading a stored run (S8)", () => {
  const DRAFT = {
    name: "workbench",
    site: { latitude: 38.2655, longitude: -0.6981, elevation: 42 },
    launchDatetime: "2026-11-07T11:00",
    atmosphere: { model: "forecast" as const, file: "GFS", station: null, fallback: "standard_atmosphere" as const },
    railOverrides: { length: 5.2 },
  };

  it("loadScenario replaces every scenario field of the draft at once", () => {
    const { result } = setup();
    act(() => result.current.setRailOverride("heading", 10));
    act(() => result.current.loadScenario(DRAFT));
    expect(result.current.state).toMatchObject(DRAFT);
    expect(result.current.state.railOverrides).toEqual({ length: 5.2 });
  });

  it("clearRun takes the displayed run off screen and keeps the draft", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", {}));
    act(() => result.current.setName("kept"));
    act(() => result.current.showRun(RUN_1));
    act(() => result.current.clearRun());
    expect(result.current.state.displayedRun).toBeNull();
    expect(result.current.state).toMatchObject({ exportId: "export-1", name: "kept" });
  });
});

describe("WizardProvider — export metadata and result provenance (Workbench)", () => {
  it("setExport stores the export filename and rocket name when given, and clears them when not", () => {
    const { result } = setup();
    act(() =>
      result.current.setExport("export-1", { name: "Icarus-2" }, "rocket-1", {
        filename: "icarus2.ork",
        rocketName: "Icarus-2",
      }),
    );
    expect(result.current.state.exportFilename).toBe("icarus2.ork");
    expect(result.current.state.rocketName).toBe("Icarus-2");

    act(() => result.current.setExport("export-2", {}, "rocket-1"));
    expect(result.current.state.exportFilename).toBeNull();
    expect(result.current.state.rocketName).toBeNull();
  });

  it("keeps the 2- and 3-argument setExport calls working (metadata defaults to null)", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", { name: "R" }));
    expect(result.current.state).toMatchObject({
      exportId: "export-1",
      rocketId: null,
      exportFilename: null,
      rocketName: null,
    });

    act(() => result.current.setExport("export-2", { name: "R" }, "rocket-2"));
    expect(result.current.state).toMatchObject({
      exportId: "export-2",
      rocketId: "rocket-2",
      exportFilename: null,
      rocketName: null,
    });
  });

  it("showRun keeps the run on screen with its own export and scenario; a later setExport leaves it alone", () => {
    const { result } = setup();
    expect(result.current.state.displayedRun).toBeNull();

    act(() => result.current.setExport("export-1", {}, null, { filename: "icarus2.ork" }));
    act(() => result.current.showRun(RUN_1));
    expect(result.current.state.displayedRun).toEqual(RUN_1);

    act(() => result.current.setExport("export-2", {}, null, { filename: "icarus2_v2.ork" }));
    expect(result.current.state.exportId).toBe("export-2");
    expect(result.current.state.displayedRun).toEqual(RUN_1);

    act(() => result.current.reset());
    expect(result.current.state.displayedRun).toBeNull();
  });
});

describe("WizardProvider — reducer", () => {
  it("reset() restores the initial state", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", { name: "R" }));
    act(() => result.current.setName("custom"));

    act(() => result.current.reset());

    expect(result.current.state.exportId).toBeNull();
    expect(result.current.exportId).toBeNull();
    expect(result.current.state.name).toBe("my_scenario");
  });

  it("scenarioBody() builds the validate/simulate payload from the current draft", () => {
    // Pin the browser to UTC so the picker's wall clock equals the UTC hour
    // regardless of the machine running the suite.
    mockBrowserTimeZone("UTC");
    const { result } = setup();
    act(() => result.current.setName("acme-1"));
    act(() =>
      result.current.setSite({ latitude: 1, longitude: 2, elevation: 3 }),
    );
    act(() => result.current.setLaunchDatetime("2026-06-01T09:54"));

    expect(result.current.scenarioBody()).toEqual({
      name: "acme-1",
      site: { latitude: 1, longitude: 2, elevation: 3 },
      date: { year: 2026, month: 6, day: 1, hour: 9 },
      atmosphere: result.current.state.atmosphere,
      uncertainty: {},
    });
    vi.restoreAllMocks();
  });
});

describe("WizardProvider — launch rail defaults and overrides (S4)", () => {
  const MANIFEST = { flight: { rail_length: 5.2, inclination: 85, heading: 90 } };

  it("setExport derives the file's rail defaults from manifest.flight", () => {
    const { result } = setup();
    expect(result.current.state.railDefaults).toBeNull();
    act(() => result.current.setExport("export-1", MANIFEST));
    expect(result.current.state.railDefaults).toEqual({ length: 5.2, inclination: 85, heading: 90 });
    expect(result.current.state.railOverrides).toEqual({});
  });

  it("an override is sent; reset deletes it so the body carries no rail again", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", MANIFEST));
    act(() => result.current.setRailOverride("inclination", 84));
    expect(result.current.state.railOverrides).toEqual({ inclination: 84 });
    expect(result.current.scenarioBody().rail).toEqual({ inclination: 84 });

    act(() => result.current.resetRailOverride("inclination"));
    expect(result.current.state.railOverrides).toEqual({});
    expect("inclination" in result.current.state.railOverrides).toBe(false);
    expect("rail" in result.current.scenarioBody()).toBe(false);
  });

  it("overrides survive a file switch while the defaults follow the new file", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", MANIFEST));
    act(() => result.current.setRailOverride("length", 3));
    act(() => result.current.setExport("export-2", { flight: { rail_length: 2, inclination: 87, heading: 0 } }));
    expect(result.current.state.railOverrides).toEqual({ length: 3 });
    expect(result.current.state.railDefaults).toEqual({ length: 2, inclination: 87, heading: 0 });
  });

  it("setExport still records the export, its rocket and display metadata", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", MANIFEST, "rocket-1", { filename: "a.ork", rocketName: "A" }));
    expect(result.current.state).toMatchObject({
      exportId: "export-1",
      rocketId: "rocket-1",
      manifest: MANIFEST,
      exportFilename: "a.ork",
      rocketName: "A",
    });
  });
});

describe("useWizard / useWizardNav / useWizardDraft — outside a provider", () => {
  it("each throws its own message when used outside a WizardProvider", () => {
    // Swallow the expected React error-boundary console.error noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useWizard())).toThrow(
      "useWizardNav must be used within a <WizardProvider>",
    );
    expect(() => renderHook(() => useWizardNav())).toThrow(
      "useWizardNav must be used within a <WizardProvider>",
    );
    expect(() => renderHook(() => useWizardDraft())).toThrow(
      "useWizardDraft must be used within a <WizardProvider>",
    );
    spy.mockRestore();
  });
});

describe("WizardProvider — render isolation (issue #50)", () => {
  it("does not re-render a useWizardNav-only consumer when a draft field changes", () => {
    const navRenders = vi.fn();
    const draftRenders = vi.fn();

    function NavProbe() {
      useWizardNav();
      navRenders();
      return null;
    }

    function DraftProbe() {
      const { setName } = useWizardDraft();
      draftRenders();
      return (
        <button onClick={() => setName("changed")}>change draft</button>
      );
    }

    render(
      <WizardProvider>
        <NavProbe />
        <DraftProbe />
      </WizardProvider>,
    );

    expect(navRenders).toHaveBeenCalledTimes(1);
    expect(draftRenders).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("change draft"));

    // The draft consumer re-renders (it just changed); the nav-only consumer
    // — the whole point of the split — does not, because typing/changing a
    // draft field no longer invalidates the nav context's memoized value.
    expect(draftRenders).toHaveBeenCalledTimes(2);
    expect(navRenders).toHaveBeenCalledTimes(1);
  });

  it("re-renders a useWizardNav consumer when the active export changes", () => {
    const navRenders = vi.fn();

    function NavProbe() {
      const { exportId } = useWizardNav();
      navRenders();
      return <span>{exportId ?? "none"}</span>;
    }

    function DraftProbe() {
      const { setExport } = useWizardDraft();
      return <button onClick={() => setExport("export-1", {})}>load</button>;
    }

    render(
      <WizardProvider>
        <NavProbe />
        <DraftProbe />
      </WizardProvider>,
    );

    expect(navRenders).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("load"));
    expect(screen.getByText("export-1")).toBeInTheDocument();
    expect(navRenders).toHaveBeenCalledTimes(2);
  });
});

describe("WizardProvider — unsaved-changes warning", () => {
  function fireBeforeUnload(): boolean {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("does not warn while the draft is untouched", () => {
    setup();
    expect(fireBeforeUnload()).toBe(false);
  });

  it("warns once the draft is dirty and stops after a run exists", () => {
    const { result, unmount } = setup();

    act(() => result.current.setExport("export-1", { name: "My rocket" }));
    expect(fireBeforeUnload()).toBe(true);

    act(() => result.current.showRun(RUN_1));
    expect(fireBeforeUnload()).toBe(false);

    act(() => result.current.reset());
    expect(fireBeforeUnload()).toBe(false);

    act(() => result.current.setName("renamed"));
    expect(fireBeforeUnload()).toBe(true);

    unmount();
    expect(fireBeforeUnload()).toBe(false);
  });
});
