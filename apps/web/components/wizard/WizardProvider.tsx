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
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  Atmosphere,
  AtmosphereModel,
  Dispersion,
  LaunchDate,
  Rail,
  Site,
  SimulateResult,
} from "@/lib/api";

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type WizardStep = "rocket" | "basics" | "advanced" | "review" | "results";

const STEP_ORDER: WizardStep[] = [
  "rocket",
  "basics",
  "advanced",
  "review",
  "results",
];

/** Atmosphere models that require a launch date (and an internet fetch). */
function needsDate(model: AtmosphereModel): boolean {
  return model === "forecast" || model === "wyoming_sounding";
}

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

  // Step 1 — rocket (from /api/convert).
  exportId: string | null;
  manifest: Record<string, unknown> | null;

  // The scenario draft.
  name: string;
  site: Site | null;
  /** Raw value from an <input type="datetime-local"> — interpreted as UTC. */
  launchDatetime: string | null;
  atmosphere: Atmosphere;
  rail: Rail | null;
  uncertainty: Record<string, Dispersion> | null;

  // Results (from /api/simulate).
  runId: string | null;
  result: SimulateResult | null;
}

type WizardAction =
  | { type: "SET_EXPORT"; exportId: string; manifest: Record<string, unknown> }
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
  manifest: null,
  name: "my_scenario",
  site: null,
  launchDatetime: null,
  atmosphere: DEFAULT_ATMOSPHERE,
  rail: null,
  uncertainty: null,
  runId: null,
  result: null,
};

function reducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "SET_EXPORT":
      return { ...state, exportId: action.exportId, manifest: action.manifest };
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
      return { ...state, result: action.result, runId: action.result.run_id };
    case "GOTO":
      return { ...state, step: action.step };
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a datetime-local string ("2026-06-01T09:54") into a LaunchDate.
 * Parsed literally (NOT via `new Date`) so no local-timezone shift is applied —
 * the domain treats the launch time as UTC.
 */
export function toLaunchDate(iso: string | null): LaunchDate | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})/);
  if (!m) return null;
  return { year: +m[1], month: +m[2], day: +m[3], hour: +m[4] };
}

/** Build the scenario body sent to /api/scenario/validate and /api/simulate. */
function buildScenarioBody(state: WizardState): Record<string, unknown> {
  return {
    name: state.name,
    site: state.site,
    date: toLaunchDate(state.launchDatetime),
    atmosphere: state.atmosphere,
    rail: state.rail,
    uncertainty: state.uncertainty,
  };
}

function canAdvance(state: WizardState): boolean {
  switch (state.step) {
    case "rocket":
      return state.exportId !== null;
    case "basics":
      return (
        state.site !== null &&
        Number.isFinite(state.site.latitude) &&
        Number.isFinite(state.site.longitude) &&
        (!needsDate(state.atmosphere.model) ||
          toLaunchDate(state.launchDatetime) !== null)
      );
    case "advanced":
      return true; // advanced overrides are all optional
    case "review":
      return state.result !== null; // only after a successful simulate
    case "results":
      return false;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface WizardContextValue {
  state: WizardState;
  /** True when the current step's local guard is satisfied. */
  canAdvance: boolean;
  /** Steps the user is allowed to jump to (everything up to the furthest reached). */
  step: WizardStep;
  setExport: (exportId: string, manifest: Record<string, unknown>) => void;
  setName: (name: string) => void;
  setSite: (site: Site | null) => void;
  setLaunchDatetime: (value: string | null) => void;
  setAtmosphere: (atmosphere: Atmosphere) => void;
  setRail: (rail: Rail | null) => void;
  setUncertainty: (uncertainty: Record<string, Dispersion> | null) => void;
  setResult: (result: SimulateResult) => void;
  goto: (step: WizardStep) => void;
  next: () => void;
  back: () => void;
  reset: () => void;
  /** Snapshot of the scenario body for validate/simulate calls. */
  scenarioBody: () => Record<string, unknown>;
  needsDate: boolean;
}

const WizardContext = createContext<WizardContextValue | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);

  const setExport = useCallback(
    (exportId: string, manifest: Record<string, unknown>) =>
      dispatch({ type: "SET_EXPORT", exportId, manifest }),
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

  const value = useMemo<WizardContextValue>(
    () => ({
      state,
      step: state.step,
      canAdvance: canAdvance(state),
      needsDate: needsDate(state.atmosphere.model),
      setExport,
      setName,
      setSite,
      setLaunchDatetime,
      setAtmosphere,
      setRail,
      setUncertainty,
      setResult,
      goto,
      next,
      back,
      reset,
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
      goto,
      next,
      back,
      reset,
      scenarioBody,
    ],
  );

  return <WizardContext.Provider value={value}>{children}</WizardContext.Provider>;
}

export function useWizard(): WizardContextValue {
  const ctx = useContext(WizardContext);
  if (!ctx) {
    throw new Error("useWizard must be used within a <WizardProvider>");
  }
  return ctx;
}

export { STEP_ORDER, needsDate };
