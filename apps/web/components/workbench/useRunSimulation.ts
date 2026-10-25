"use client";

/**
 * The Workbench's Run action — the wizard's ReviewStep.run() without the
 * navigation: POST /api/simulate with the active export and the scenario
 * body from WizardProvider, then keep the result in the draft so the results
 * column renders it in place.
 *
 * Also owns the two derived facts the command row shows about a run:
 *   - `ready`: the guard (export + finite site + date when the model needs
 *     one, nothing in flight, and not held by the caller — e.g. while a
 *     `.ork` is converting, S8/A2);
 *   - `stale`: the results on screen belong to a previous export, so the
 *     status pill says "Results are from …" and the button "Run this file".
 *
 * Error contract (unchanged from the wizard):
 *   401 → handled globally by lib/query-client.ts, nothing to do here
 *   422 → `errors` (FieldError[]) for the input sections / results column
 *   503 → the server's `hint` verbatim; other codes map to t("errors.<code>")
 */

import { useCallback, useState } from "react";
import { ApiError, type FieldError } from "@/lib/api";
import { useSimulateMutation } from "@/lib/queries";
import { canRun } from "@/lib/domain/scenario";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { useT } from "@/components/i18n/LocaleProvider";
import { focusFirstError } from "./fieldErrors";

export interface RunSimulation {
  /** Send the draft to /api/simulate. No-op while not `ready`. */
  run: () => Promise<void>;
  /** True when the draft can run right now (guard satisfied, nothing in flight, not held). */
  ready: boolean;
  busy: boolean;
  /** True when the results on screen were computed from a different export than the active one. */
  stale: boolean;
  errors: FieldError[];
  fatal: string | null;
}

export function useRunSimulation(options?: { hold?: boolean }): RunSimulation {
  const { state, setResult, scenarioBody } = useWizardDraft();
  const t = useT();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const { mutateAsync, isPending } = useSimulateMutation();

  const hold = options?.hold ?? false;
  const ready = canRun(state) && !isPending && !hold;
  const stale = state.result !== null && state.resultExportId !== state.exportId;
  const exportId = state.exportId;

  const run = useCallback(async () => {
    if (!exportId || !ready) return;
    setErrors([]);
    setFatal(null);
    try {
      const result = await mutateAsync({ exportId, scenario: scenarioBody() });
      setResult(result);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) return;
      if (err instanceof ApiError && err.isValidation) {
        const fieldErrors = err.fieldErrors ?? [];
        setErrors(fieldErrors);
        focusFirstError(fieldErrors);
      } else if (err instanceof ApiError) {
        setFatal(err.hint ?? t(`errors.${err.code}`, { status: err.status }));
      } else {
        setFatal(t("review.errorGeneric"));
      }
    }
  }, [exportId, ready, mutateAsync, scenarioBody, setResult, t]);

  return { run, ready, busy: isPending, stale, errors, fatal };
}
