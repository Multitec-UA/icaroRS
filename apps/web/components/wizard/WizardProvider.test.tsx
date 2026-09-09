import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { WizardProvider, toLaunchDate, useWizard } from "./WizardProvider";

function wrapper({ children }: { children: ReactNode }) {
  return <WizardProvider>{children}</WizardProvider>;
}

function setup() {
  return renderHook(() => useWizard(), { wrapper });
}

describe("toLaunchDate", () => {
  it("returns null for a null input", () => {
    expect(toLaunchDate(null)).toBeNull();
  });

  it("parses a datetime-local string literally, without a timezone shift", () => {
    expect(toLaunchDate("2026-06-01T09:54")).toEqual({
      year: 2026,
      month: 6,
      day: 1,
      hour: 9,
    });
  });

  it("returns null for a malformed string", () => {
    expect(toLaunchDate("not-a-date")).toBeNull();
  });
});

describe("WizardProvider — canAdvance per step", () => {
  it("rocket: false until an export id is set", () => {
    const { result } = setup();
    expect(result.current.step).toBe("rocket");
    expect(result.current.canAdvance).toBe(false);

    act(() => result.current.setExport("export-1", { name: "My rocket" }));

    expect(result.current.canAdvance).toBe(true);
    expect(result.current.state.exportId).toBe("export-1");
  });

  it("basics: requires a finite site, and a launch date only when the atmosphere model needs one", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", {}));
    act(() => result.current.next());
    expect(result.current.step).toBe("basics");
    expect(result.current.canAdvance).toBe(false);

    act(() =>
      result.current.setSite({ latitude: 10, longitude: 20, elevation: null }),
    );
    // Default atmosphere model ("standard_atmosphere") does not need a date.
    expect(result.current.needsDate).toBe(false);
    expect(result.current.canAdvance).toBe(true);

    act(() =>
      result.current.setAtmosphere({
        model: "forecast",
        file: null,
        station: null,
        fallback: "standard_atmosphere",
      }),
    );
    expect(result.current.needsDate).toBe(true);
    expect(result.current.canAdvance).toBe(false);

    act(() => result.current.setLaunchDatetime("not-a-date"));
    expect(result.current.canAdvance).toBe(false);

    act(() => result.current.setLaunchDatetime("2026-06-01T09:54"));
    expect(result.current.canAdvance).toBe(true);
  });

  it("basics: false when the site has a non-finite coordinate", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", {}));
    act(() => result.current.next());

    act(() =>
      result.current.setSite({ latitude: Number.NaN, longitude: 20, elevation: null }),
    );
    expect(result.current.canAdvance).toBe(false);
  });

  it("advanced: always true (overrides are optional)", () => {
    const { result } = setup();
    act(() => result.current.goto("advanced"));
    expect(result.current.canAdvance).toBe(true);
  });

  it("review: false until a result is set", () => {
    const { result } = setup();
    act(() => result.current.goto("review"));
    expect(result.current.canAdvance).toBe(false);

    act(() =>
      result.current.setResult({
        run_id: "run-1",
        scalars: {},
        plot_urls: [],
        warnings: [],
      }),
    );
    expect(result.current.canAdvance).toBe(true);
    expect(result.current.state.runId).toBe("run-1");
  });

  it("results: always false (terminal step)", () => {
    const { result } = setup();
    act(() => result.current.goto("results"));
    expect(result.current.canAdvance).toBe(false);
  });
});

describe("WizardProvider — reducer / navigation", () => {
  it("next() walks the step order forward and stops at the last step", () => {
    const { result } = setup();
    const order = ["rocket", "basics", "advanced", "review", "results"];
    for (let i = 0; i < order.length - 1; i++) {
      expect(result.current.step).toBe(order[i]);
      act(() => result.current.next());
    }
    expect(result.current.step).toBe("results");
    act(() => result.current.next());
    expect(result.current.step).toBe("results");
  });

  it("back() walks the step order backward and stops at the first step", () => {
    const { result } = setup();
    act(() => result.current.goto("advanced"));
    act(() => result.current.back());
    expect(result.current.step).toBe("basics");
    act(() => result.current.back());
    expect(result.current.step).toBe("rocket");
    act(() => result.current.back());
    expect(result.current.step).toBe("rocket");
  });

  it("goto() jumps directly to any step", () => {
    const { result } = setup();
    act(() => result.current.goto("review"));
    expect(result.current.step).toBe("review");
  });

  it("reset() restores the initial state", () => {
    const { result } = setup();
    act(() => result.current.setExport("export-1", { name: "R" }));
    act(() => result.current.setName("custom"));
    act(() => result.current.goto("review"));

    act(() => result.current.reset());

    expect(result.current.step).toBe("rocket");
    expect(result.current.state.exportId).toBeNull();
    expect(result.current.state.name).toBe("my_scenario");
    expect(result.current.canAdvance).toBe(false);
  });

  it("scenarioBody() builds the validate/simulate payload from the current draft", () => {
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
      rail: null,
      uncertainty: null,
    });
  });
});

describe("useWizard", () => {
  it("throws when used outside a WizardProvider", () => {
    // Swallow the expected React error-boundary console.error noise.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useWizard())).toThrow(
      "useWizard must be used within a <WizardProvider>",
    );
    spy.mockRestore();
  });
});
