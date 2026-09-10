import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import {
  WizardProvider,
  useWizard,
  useWizardDraft,
  useWizardNav,
} from "./WizardProvider";

// Pure domain-rule tests (toLaunchDate, buildScenarioBody, canAdvance,
// needsDate) live in lib/domain/scenario.test.ts (issue #50) — no rendering
// needed there. This file covers the React wiring: the reducer, the two
// contexts, and the render-isolation the split is for.

function wrapper({ children }: { children: ReactNode }) {
  return <WizardProvider>{children}</WizardProvider>;
}

function setup() {
  return renderHook(() => useWizard(), { wrapper });
}

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

  it("re-renders a useWizardNav consumer when the step changes", () => {
    const navRenders = vi.fn();

    function NavProbe() {
      const { step, goto } = useWizardNav();
      navRenders();
      return <button onClick={() => goto("basics")}>{step}</button>;
    }

    render(
      <WizardProvider>
        <NavProbe />
      </WizardProvider>,
    );

    expect(navRenders).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("rocket"));
    expect(navRenders).toHaveBeenCalledTimes(2);
  });
});
