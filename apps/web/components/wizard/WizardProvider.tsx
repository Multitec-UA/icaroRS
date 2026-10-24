"use client";

/**
 * WizardProvider — the explicit state machine driving the scenario wizard.
 *
 * Flow:  rocket → basics → advanced → review → results
 *
 * It holds the scenario draft assembled across steps plus the convert/simulate
 * artifacts (exportId, runId, result). "Can advance" guards use LOCAL state
 * only — they gate the Next button for fast UX feedback. The API
 * (/api/scenario/validate, /api/simulate) remains the single source of truth
 * for correctness; the wizard never decides a scenario is valid on its own.
 *
 * React context must live in a Client Component (Next 16 — server components
 * can't hold context), hence "use client" at the top.
 *
 * Domain rules (toLaunchDate, buildScenarioBody, canAdvance, needsDate,
 * STEP_ORDER) live in lib/domain/scenario.ts (issue #50) — plain functions,
 * unit-testable without rendering anything. This file is just the React
 * wiring: the reducer and two contexts.
 *
 * Two contexts, not one (issue #50): a single context whose value depends on
 * the whole draft meant every consumer re-rendered on every keystroke,
 * including AppNav/Stepper/WizardShell, which only care about the step and
 * whether a rocket has been uploaded. `WizardNavContext` carries exactly
 * that; `WizardDraftContext` carries the rest and is memoized separately, so
 * a draft-only change never invalidates a nav-only consumer.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type { Atmosphere, Dispersion, Rail, Site, SimulateResult } from "@/lib/api";
import {
  STEP_ORDER,
  buildScenarioBody,
  canAdvance as computeCanAdvance,
  needsDate as computeNeedsDate,
  type WizardStep,
} from "@/lib/domain/scenario";

const DEFAULT_ATMOSPHERE: Atmosphere = {
  model: "standard_atmosphere",
  file: null,
  station: null,
  fallback: "standard_atmosphere",
};

// ---------------------------------------------------------------------------
// State + actions
// ---------------------------------------------------------------------------

interface WizardState {
  step: WizardStep;

  // Step 1 — the export (converted .ork) from /api/convert, and the rocket it
  // belongs to (null for responses that predate the Rocket/Export split).
  exportId: string | null;
  rocketId: string | null;
  manifest: Record<string, unknown> | null;
  // Display metadata for the Workbench's rocket context button: the .ork
  // filename of the export and the name of its rocket. Null when the caller
  // did not know them (older call sites pass only the ids).
  exportFilename: string | null;
  rocketName: string | null;

  // The scenario draft.
  name: string;
  site: Site | null;
  /** Raw value from an <input type="datetime-local"> — interpreted as UTC. */
  launchDatetime: string | null;
  atmosphere: Atmosphere;
  rail: Rail | null;
  uncertainty: Record<string, Dispersion> | null;

  // Results (from /api/simulate), plus the export they were computed from:
  // when the active export changes after a run, the Workbench's status pill
  // says the results on screen belong to the previous file.
  runId: string | null;
  result: SimulateResult | null;
  resultExportId: string | null;
  resultExportFilename: string | null;
}

/** Optional display metadata recorded alongside an export (see `setExport`). */
export interface ExportMeta {
  filename?: string | null;
  rocketName?: string | null;
}

type WizardAction =
  | {
      type: "SET_EXPORT";
      exportId: string;
      manifest: Record<string, unknown>;
      rocketId: string | null;
      exportFilename: string | null;
      rocketName: string | null;
    }
  | { type: "SET_NAME"; name: string }
  | { type: "SET_SITE"; site: Site | null }
  | { type: "SET_LAUNCH_DATETIME"; value: string | null }
  | { type: "SET_ATMOSPHERE"; atmosphere: Atmosphere }
  | { type: "SET_RAIL"; rail: Rail | null }
  | { type: "SET_UNCERTAINTY"; uncertainty: Record<string, Dispersion> | null }
  | { type: "SET_RESULT"; result: SimulateResult }
  | { type: "GOTO"; step: WizardStep }
  | { type: "RESET" };

const INITIAL_STATE: WizardState = {
  step: "rocket",
  exportId: null,
  rocketId: null,
  manifest: null,
  exportFilename: null,
  rocketName: null,
  name: "my_scenario",
  site: null,
  launchDatetime: null,
  atmosphere: DEFAULT_ATMOSPHERE,
  rail: null,
  uncertainty: null,
  runId: null,
  result: null,
  resultExportId: null,
  resultExportFilename: null,
};

/**
 * True once any user-entered draft data differs from the initial state. The
 * reducer only ever replaces these fields with new references (or resets
 * them to the INITIAL_STATE values), so identity checks are both cheap and
 * exact — no deep compare needed. `step` is deliberately excluded: moving
 * between steps is not data.
 */
function isDraftDirty(state: WizardState): boolean {
  return (
    state.exportId !== INITIAL_STATE.exportId ||
    state.name !== INITIAL_STATE.name ||
    state.site !== INITIAL_STATE.site ||
    state.launchDatetime !== INITIAL_STATE.launchDatetime ||
    state.atmosphere !== INITIAL_STATE.atmosphere ||
    state.rail !== INITIAL_STATE.rail ||
    state.uncertainty !== INITIAL_STATE.uncertainty
  );
}

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_EXPORT":
      return {
        ...state,
        exportId: action.exportId,
        rocketId: action.rocketId,
        manifest: action.manifest,
        exportFilename: action.exportFilename,
        rocketName: action.rocketName,
      };
    case "SET_NAME":
      return { ...state, name: action.name };
    case "SET_SITE":
      return { ...state, site: action.site };
    case "SET_LAUNCH_DATETIME":
      return { ...state, launchDatetime: action.value };
    case "SET_ATMOSPHERE":
      return { ...state, atmosphere: action.atmosphere };
    case "SET_RAIL":
      return { ...state, rail: action.rail };
    case "SET_UNCERTAINTY":
      return { ...state, uncertainty: action.uncertainty };
    case "SET_RESULT":
      return {
        ...state,
        result: action.result,
        runId: action.result.run_id,
        resultExportId: state.exportId,
        resultExportFilename: state.exportFilename,
      };
    case "GOTO":
      return { ...state, step: action.step };
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Nav context — step + navigation only. Consumers: AppNav, Stepper,
// WizardShell. Memoized on just `state.step` / `state.exportId`, so it never
// changes identity when a draft field (name, site, uncertainty, ...) changes.
// ---------------------------------------------------------------------------

interface WizardNavContextValue {
  step: WizardStep;
  /** Whether a rocket has been uploaded — Stepper uses this to gate jumping ahead. */
  exportId: string | null;
  goto: (step: WizardStep) => void;
  next: () => void;
  back: () => void;
  reset: () => void;
}

const WizardNavContext = createContext<WizardNavContextValue | null>(null);

export function useWizardNav(): WizardNavContextValue {
  const ctx = useContext(WizardNavContext);
  if (!ctx) {
    throw new Error("useWizardNav must be used within a <WizardProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Draft context — the scenario draft, its setters, and the derived guards
// that depend on it. Consumers: the step components, ResultsDashboard,
// RocketsList. Memoized on the whole `state`, so it changes on every
// keystroke — expected, since these consumers render the draft itself.
// ---------------------------------------------------------------------------

interface WizardDraftContextValue {
  state: WizardState;
  /** True when the current step's local guard is satisfied. */
  canAdvance: boolean;
  needsDate: boolean;
  /**
   * Record the converted export (and, when known, the rocket it belongs to
   * and the display metadata the Workbench shows: filename + rocket name).
   */
  setExport: (
    exportId: string,
    manifest: Record<string, unknown>,
    rocketId?: string | null,
    meta?: ExportMeta,
  ) => void;
  setName: (name: string) => void;
  setSite: (site: Site | null) => void;
  setLaunchDatetime: (value: string | null) => void;
  setAtmosphere: (atmosphere: Atmosphere) => void;
  setRail: (rail: Rail | null) => void;
  setUncertainty: (uncertainty: Record<string, Dispersion> | null) => void;
  setResult: (result: SimulateResult) => void;
  /** Snapshot of the scenario body for validate/simulate calls. */
  scenarioBody: () => Record<string, unknown>;
}

const WizardDraftContext = createContext<WizardDraftContextValue | null>(null);

export function useWizardDraft(): WizardDraftContextValue {
  const ctx = useContext(WizardDraftContext);
  if (!ctx) {
    throw new Error("useWizardDraft must be used within a <WizardProvider>");
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Combined convenience hook — for consumers that already need both slices
// (most step components: a draft field AND `next()`/`back()`). Re-renders
// whenever either slice changes, which is correct for these — they already
// read decision fields from both. Nav-only consumers should use
// `useWizardNav` directly instead of this, or they lose the isolation.
// ---------------------------------------------------------------------------

export function useWizard(): WizardNavContextValue & WizardDraftContextValue {
  const nav = useWizardNav();
  const draft = useWizardDraft();
  return { ...nav, ...draft };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const setExport = useCallback(
    (
      exportId: string,
      manifest: Record<string, unknown>,
      rocketId?: string | null,
      meta?: ExportMeta,
    ) =>
      dispatch({
        type: "SET_EXPORT",
        exportId,
        manifest,
        rocketId: rocketId ?? null,
        exportFilename: meta?.filename ?? null,
        rocketName: meta?.rocketName ?? null,
      }),
    [],
  );
  const setName = useCallback(
    (name: string) => dispatch({ type: "SET_NAME", name }),
    [],
  );
  const setSite = useCallback(
    (site: Site | null) => dispatch({ type: "SET_SITE", site }),
    [],
  );
  const setLaunchDatetime = useCallback(
    (value: string | null) => dispatch({ type: "SET_LAUNCH_DATETIME", value }),
    [],
  );
  const setAtmosphere = useCallback(
    (atmosphere: Atmosphere) => dispatch({ type: "SET_ATMOSPHERE", atmosphere }),
    [],
  );
  const setRail = useCallback(
    (rail: Rail | null) => dispatch({ type: "SET_RAIL", rail }),
    [],
  );
  const setUncertainty = useCallback(
    (uncertainty: Record<string, Dispersion> | null) =>
      dispatch({ type: "SET_UNCERTAINTY", uncertainty }),
    [],
  );
  const setResult = useCallback(
    (result: SimulateResult) => dispatch({ type: "SET_RESULT", result }),
    [],
  );
  const goto = useCallback(
    (step: WizardStep) => dispatch({ type: "GOTO", step }),
    [],
  );
  const next = useCallback(() => {
    const i = STEP_ORDER.indexOf(state.step);
    if (i >= 0 && i < STEP_ORDER.length - 1) {
      dispatch({ type: "GOTO", step: STEP_ORDER[i + 1] });
    }
  }, [state.step]);
  const back = useCallback(() => {
    const i = STEP_ORDER.indexOf(state.step);
    if (i > 0) dispatch({ type: "GOTO", step: STEP_ORDER[i - 1] });
  }, [state.step]);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);
  const scenarioBody = useCallback(() => buildScenarioBody(state), [state]);

  // The draft lives only in memory: warn before a reload/close would throw
  // it away. Once a run exists the work is persisted server-side, so leaving
  // is safe again. The listener is attached only while it matters, so a
  // clean wizard never blocks navigation.
  const warnOnUnload = state.runId === null && isDraftDirty(state);
  useEffect(() => {
    if (!warnOnUnload) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers only honor a (possibly empty) string return value.
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [warnOnUnload]);

  const navValue = useMemo<WizardNavContextValue>(
    () => ({
      step: state.step,
      exportId: state.exportId,
      goto,
      next,
      back,
      reset,
    }),
    [state.step, state.exportId, goto, next, back, reset],
  );

  const draftValue = useMemo<WizardDraftContextValue>(
    () => ({
      state,
      canAdvance: computeCanAdvance(state.step, state),
      needsDate: computeNeedsDate(state.atmosphere.model),
      setExport,
      setName,
      setSite,
      setLaunchDatetime,
      setAtmosphere,
      setRail,
      setUncertainty,
      setResult,
      scenarioBody,
    }),
    [
      state,
      setExport,
      setName,
      setSite,
      setLaunchDatetime,
      setAtmosphere,
      setRail,
      setUncertainty,
      setResult,
      scenarioBody,
    ],
  );

  return (
    <WizardNavContext.Provider value={navValue}>
      <WizardDraftContext.Provider value={draftValue}>
        {children}
      </WizardDraftContext.Provider>
    </WizardNavContext.Provider>
  );
}
