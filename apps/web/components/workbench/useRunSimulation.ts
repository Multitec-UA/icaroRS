"use client";

/**
 * The Workbench's Run action — the wizard's ReviewStep.run() without the
 * navigation: POST /api/simulate with the active export and the scenario
 * body from WizardProvider, then keep the result in the draft so the results
 * column renders it in place.
 *
 * A successful run becomes the displayed run (WizardProvider.showRun) with
 * the exact body it was sent, so the status compares like with like.
 *
 * Also owns the two derived facts the command row shows about a run:
 *   - `ready`: the guard (export + finite site + date when the model needs
 *     one, nothing in flight, and not held by the caller — e.g. while a
 *     `.ork` is converting, S8/A2);
 *   - `status` (S6): "none" before any run, "running" while one is in
 *     flight, else the displayed run compared with the current draft
 *     (`scenarioDiff` over canonical bodies + export id): "upToDate" when
 *     nothing differs, "changed" with the groups that do. Edits made while a
 *     run is in flight are kept, so its result can arrive already "changed".
 *
 * Leaving mid-run (S8): the request keeps going (the API writes the run on
 * completion and the draft lives in the root layout, so the result still
 * becomes the displayed run). When it resolves after the Workbench
 * unmounted, a toast says so on whatever route the user is on: "Run {id}
 * finished" with a link to `/?run={id}`, or "Run failed: {detail}".
 *
 * Error contract (unchanged from the wizard):
 *   401 → handled globally by lib/query-client.ts, nothing to do here
 *   422 → `errors` (FieldError[]) for the input sections / results column
 *   503 → the server's `hint` verbatim; other codes map to t("errors.<code>")
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, type FieldError } from "@/lib/api";
import { useSimulateMutation } from "@/lib/queries";
import { canRun, scenarioDiff } from "@/lib/domain/scenario";
import type { ChangeGroup } from "@/lib/domain/runs";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { showToast } from "@/components/ui";
import { workbenchRunHref } from "@/components/runs/OpenInWorkbenchButton";
import { useT } from "@/components/i18n/LocaleProvider";
import { focusFirstError } from "./fieldErrors";

export type RunStatus =
  | { kind: "none" }
  | { kind: "running" }
  | { kind: "upToDate"; runId: string }
  | { kind: "changed"; runId: string; changes: ChangeGroup[] };

export interface RunSimulation {
  /** Send the draft to /api/simulate. No-op while not `ready`. */
  run: () => Promise<void>;
  /** True when the draft can run right now (guard satisfied, nothing in flight, not held). */
  ready: boolean;
  busy: boolean;
  /** The draft compared with the displayed run (S6). */
  status: RunStatus;
  /** True once a run is on screen: the button then reads "Run again". */
  hasRun: boolean;
  errors: FieldError[];
  fatal: string | null;
}

export function useRunSimulation(options?: { hold?: boolean }): RunSimulation {
  const { state, showRun, scenarioBody } = useWizardDraft();
  const t = useT();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const { mutateAsync, isPending } = useSimulateMutation();
  // False once the Workbench unmounted: an outcome then becomes a toast.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const hold = options?.hold ?? false;
  const ready = canRun(state) && !isPending && !hold;
  const exportId = state.exportId;
  const { displayedRun, exportFilename, manifest } = state;

  const status = useMemo<RunStatus>(() => {
    if (isPending) return { kind: "running" };
    if (!displayedRun) return { kind: "none" };
    const changes = scenarioDiff(displayedRun, { exportId, scenario: scenarioBody() });
    return changes.length === 0
      ? { kind: "upToDate", runId: displayedRun.runId }
      : { kind: "changed", runId: displayedRun.runId, changes };
  }, [isPending, displayedRun, exportId, scenarioBody]);

  const run = useCallback(async () => {
    if (!exportId || !ready) return;
    setErrors([]);
    setFatal(null);
    try {
      const scenario = scenarioBody();
      const result = await mutateAsync({ exportId, scenario });
      showRun({ runId: result.run_id, exportId, scenario, result, exportFilename, manifest });
      if (!mounted.current) {
        showToast({
          tone: "ok",
          message: t("workbench.toastRunFinished", { runId: result.run_id }),
          action: { href: workbenchRunHref(result.run_id), label: t("workbench.toastOpen") },
        });
      }
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) return;
      if (!mounted.current) {
        const detail = err instanceof ApiError ? (err.hint ?? err.message) : t("workbench.runFailed");
        showToast({ tone: "bad", message: t("workbench.toastRunFailed", { detail }) });
        return;
      }
      if (err instanceof ApiError && err.isValidation) {
        const fieldErrors = err.fieldErrors ?? [];
        setErrors(fieldErrors);
        focusFirstError(fieldErrors);
      } else if (err instanceof ApiError) {
        setFatal(err.hint ?? t(`errors.${err.code}`, { status: err.status }));
      } else {
        setFatal(t("workbench.runFailed"));
      }
    }
  }, [exportId, exportFilename, manifest, ready, mutateAsync, scenarioBody, showRun, t]);

  return { run, ready, busy: isPending, status, hasRun: displayedRun !== null, errors, fatal };
}
