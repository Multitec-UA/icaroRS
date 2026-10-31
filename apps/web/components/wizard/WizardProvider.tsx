"use client";

/**
 * WizardProvider — the Workbench's draft: the active export (converted
 * `.ork`), the scenario being edited and the run on screen. It outlives the
 * Workbench (it sits in the root layout), so moving to /runs or a report and
 * back keeps the draft in memory; the Workbench mirrors its identity into
 * the URL (`useWorkbenchUrl`, S8). The name predates the Workbench; renaming
 * it would touch the root layout and the shared test providers.
 *
 * The API (/api/simulate) is the single source of truth for correctness;
 * the local guards (lib/domain/scenario.ts: `canRun`, `needsDate`) only give
 * fast feedback. Domain rules live there as plain functions; this file is
 * the React wiring: the reducer and two contexts.
 *
 * Two contexts, not one (issue #50): `WizardNavContext` carries only the
 * active export id and `reset`, so a nav-only consumer (the report's
 * actions) never re-renders on a draft keystroke; `WizardDraftContext`
 * carries the rest and is memoized separately.
 *
 * React context must live in a Client Component (Next 16), hence "use client".
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
import type { Atmosphere, Site, SimulateResult } from "@/lib/api";
import {
  buildScenarioBody,
  needsDate as computeNeedsDate,
  type RailOverrides,
  type ScenarioDraft,
} from "@/lib/domain/scenario";
import { railDefaultsFromManifest, type RailDefaults } from "@/lib/domain/rocket";

export type RailField = keyof RailOverrides;

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
  // The export (converted .ork) from /api/convert, and the rocket it
  // belongs to (null for responses that predate the Rocket/Export split).
  exportId: string | null;
  rocketId: string | null;
  manifest: Record<string, unknown> | null;
  // Display metadata for the Workbench's rocket context button: the .ork
  // filename of the export and the name of its rocket. Null when the caller
  // did not know them (older call sites pass only the ids).
  exportFilename: string | null;
  rocketName: string | null;
  // The active file's launch rail (`manifest.flight`), derived at setExport.
  railDefaults: RailDefaults | null;

  // The scenario draft.
  name: string;
  site: Site | null;
  /** Raw value from an <input type="datetime-local"> — interpreted as UTC. */
  launchDatetime: string | null;
  atmosphere: Atmosphere;
  /**
   * Only the rail values the user typed over the file's own (S4). Kept
   * across file switches, so an override shows as such against the next
   * file's defaults instead of silently turning into a default.
   */
  railOverrides: RailOverrides;

  /**
   * The run on screen (S6): the reference the Workbench's status compares
   * the draft with. Set by a successful run (useRunSimulation) and, later,
   * when a run is opened from /runs. Null before the first run.
   */
  displayedRun: DisplayedRun | null;
}

/**
 * One run as the Workbench shows it: its id, the export and scenario it was
 * sent (verbatim, as the request body or the stored history row), the
 * result, and the export's display metadata at that time so the results
 * keep describing the file they came from after another one is loaded.
 */
export interface DisplayedRun {
  runId: string;
  exportId: string;
  scenario: Record<string, unknown>;
  result: SimulateResult;
  exportFilename?: string | null;
  manifest?: Record<string, unknown> | null;
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
  | { type: "SET_RAIL_OVERRIDE"; field: RailField; value: number }
  | { type: "RESET_RAIL_OVERRIDE"; field: RailField }
  | { type: "LOAD_SCENARIO"; draft: ScenarioDraft }
  | { type: "SHOW_RUN"; run: DisplayedRun | null }
  | { type: "RESET" };

const INITIAL_STATE: WizardState = {
  exportId: null,
  rocketId: null,
  manifest: null,
  exportFilename: null,
  rocketName: null,
  railDefaults: null,
  name: "my_scenario",
  site: null,
  launchDatetime: null,
  atmosphere: DEFAULT_ATMOSPHERE,
  railOverrides: {},
  displayedRun: null,
};

/**
 * True once any user-entered draft data differs from the initial state. The
 * reducer only ever replaces these fields with new references (or resets
 * them to the INITIAL_STATE values), so identity checks are both cheap and
 * exact — no deep compare needed.
 */
function isDraftDirty(state: WizardState): boolean {
  return (
    state.exportId !== INITIAL_STATE.exportId ||
    state.name !== INITIAL_STATE.name ||
    state.site !== INITIAL_STATE.site ||
    state.launchDatetime !== INITIAL_STATE.launchDatetime ||
    state.atmosphere !== INITIAL_STATE.atmosphere ||
    state.railOverrides !== INITIAL_STATE.railOverrides
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
        railDefaults: railDefaultsFromManifest(action.manifest),
      };
    case "SET_NAME":
      return { ...state, name: action.name };
    case "SET_SITE":
      return { ...state, site: action.site };
    case "SET_LAUNCH_DATETIME":
      return { ...state, launchDatetime: action.value };
    case "SET_ATMOSPHERE":
      return { ...state, atmosphere: action.atmosphere };
    case "SET_RAIL_OVERRIDE":
      return { ...state, railOverrides: { ...state.railOverrides, [action.field]: action.value } };
    case "RESET_RAIL_OVERRIDE": {
      if (!(action.field in state.railOverrides)) return state;
      const rest = { ...state.railOverrides };
      delete rest[action.field];
      // Back to the initial reference when empty, so the draft can be clean again.
      return { ...state, railOverrides: Object.keys(rest).length > 0 ? rest : INITIAL_STATE.railOverrides };
    }
    case "LOAD_SCENARIO": {
      const { name, site, launchDatetime, atmosphere, railOverrides } = action.draft;
      return {
        ...state,
        name,
        site,
        launchDatetime,
        atmosphere,
        railOverrides: Object.keys(railOverrides).length > 0 ? railOverrides : INITIAL_STATE.railOverrides,
      };
    }
    case "SHOW_RUN":
      return { ...state, displayedRun: action.run };
    case "RESET":
      return INITIAL_STATE;
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Nav context — the active export id and `reset` only. Memoized on just
// `state.exportId`, so it never changes identity when a draft field (name,
// site, rail, ...) changes.
// ---------------------------------------------------------------------------

interface WizardNavContextValue {
  /** The active export, or null before a file is loaded. */
  exportId: string | null;
  /** Back to an empty Workbench: no file, default scenario, no run. */
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
// that depend on it. Consumers: the Workbench sections, top bar and results
// column, the rocket cards. Memoized on the whole `state`, so it changes on every
// keystroke — expected, since these consumers render the draft itself.
// ---------------------------------------------------------------------------

interface WizardDraftContextValue {
  state: WizardState;
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
  /** Override one rail field with a value the user typed. */
  setRailOverride: (field: RailField, value: number) => void;
  /** Drop one rail override: the field shows the file's value again. */
  resetRailOverride: (field: RailField) => void;
  /** Replace the scenario fields at once — a stored run opened from its URL (S8). */
  loadScenario: (draft: ScenarioDraft) => void;
  /** Put a run on screen: the results column renders it and the status compares the draft with it. */
  showRun: (run: DisplayedRun) => void;
  /** Take the displayed run off screen and keep the draft (back to `/?file=`). */
  clearRun: () => void;
  /** Snapshot of the scenario body for the simulate call. */
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
// Combined convenience hook — both slices; re-renders whenever either
// changes. Nav-only consumers should use `useWizardNav` directly instead.
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
  const setRailOverride = useCallback(
    (field: RailField, value: number) => dispatch({ type: "SET_RAIL_OVERRIDE", field, value }),
    [],
  );
  const resetRailOverride = useCallback(
    (field: RailField) => dispatch({ type: "RESET_RAIL_OVERRIDE", field }),
    [],
  );
  const loadScenario = useCallback((draft: ScenarioDraft) => dispatch({ type: "LOAD_SCENARIO", draft }), []);
  const showRun = useCallback((run: DisplayedRun) => dispatch({ type: "SHOW_RUN", run }), []);
  const clearRun = useCallback(() => dispatch({ type: "SHOW_RUN", run: null }), []);
  const reset = useCallback(() => dispatch({ type: "RESET" }), []);
  const scenarioBody = useCallback(() => buildScenarioBody(state), [state]);

  // The draft lives only in memory: warn before a reload/close would throw
  // it away. Once a run exists the work is persisted server-side, so leaving
  // is safe again. The listener is attached only while it matters, so a
  // clean draft never blocks navigation.
  const warnOnUnload = state.displayedRun === null && isDraftDirty(state);
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
    () => ({ exportId: state.exportId, reset }),
    [state.exportId, reset],
  );

  const draftValue = useMemo<WizardDraftContextValue>(
    () => ({
      state,
      needsDate: computeNeedsDate(state.atmosphere.model),
      setExport,
      setName,
      setSite,
      setLaunchDatetime,
      setAtmosphere,
      setRailOverride,
      resetRailOverride,
      loadScenario,
      showRun,
      clearRun,
      scenarioBody,
    }),
    [
      state,
      setExport,
      setName,
      setSite,
      setLaunchDatetime,
      setAtmosphere,
      setRailOverride,
      resetRailOverride,
      loadScenario,
      showRun,
      clearRun,
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
