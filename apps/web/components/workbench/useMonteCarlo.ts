"use client";

/**
 * The Workbench's Monte Carlo dispersion (S12): launch, follow and dismiss
 * one run, beside (never instead of) the deterministic Run.
 *
 * - The run on screen is the URL's `mc=` (useWorkbenchUrl), so a reload
 *   resumes polling it, or shows its result once done.
 * - `launch(n)` queues the active file with the scenario on screen, the same
 *   body /simulate gets (`scenarioBody`; without an `uncertainty` block the
 *   API applies its defaults), then puts the new run in the URL.
 * - Progress comes from `useMonteCarloQuery`, polled every ~2 s while the run
 *   is queued or running.
 *
 * Nothing here touches the deterministic run's state or its in-flight flag,
 * so a queued or running dispersion never blocks Run.
 */

import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api";
import { useMonteCarloQuery, useSubmitMonteCarloMutation } from "@/lib/queries";
import { runBlocker } from "@/lib/domain/scenario";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { useT } from "@/components/i18n/LocaleProvider";
import type { WorkbenchUrl } from "./useWorkbenchUrl";

export interface MonteCarloControl {
  /** The run on screen (`mc=`), or null. */
  runId: string | null;
  run: ReturnType<typeof useMonteCarloQuery>;
  /** Queue `flights` flights; resolves `false` when the API refused. */
  launch: (flights: number) => Promise<boolean>;
  submitting: boolean;
  submitError: string | null;
  /** Why a launch is not possible right now, or null. */
  disabledReason: string | null;
  dismiss: () => void;
}

export function useMonteCarlo(url: WorkbenchUrl): MonteCarloControl {
  const t = useT();
  const { state, scenarioBody } = useWizardDraft();
  const runId = url.monteCarloId;
  const run = useMonteCarloQuery(runId);
  const { mutateAsync, isPending } = useSubmitMonteCarloMutation();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { setMonteCarloId } = url;
  const exportId = state.exportId;

  const blocker = runBlocker(state);
  const disabledReason =
    blocker === "site" ? t("workbench.runNeedsSite") : blocker === "date" ? t("workbench.runNeedsDate") : null;

  const launch = useCallback(
    async (flights: number) => {
      if (!exportId || disabledReason) return false;
      setSubmitError(null);
      try {
        const submitted = await mutateAsync({ export_id: exportId, scenario: scenarioBody(), n: flights });
        setMonteCarloId(submitted.run_id);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.isUnauthorized) return false;
        if (err instanceof ApiError && err.isValidation) {
          setSubmitError((err.fieldErrors ?? []).map((e) => e.message).join(" ") || err.message);
        } else if (err instanceof ApiError) {
          setSubmitError(err.hint ?? t(`errors.${err.code}`, { status: err.status }));
        } else {
          setSubmitError(t("montecarlo.errorFallback"));
        }
        return false;
      }
    },
    [disabledReason, exportId, mutateAsync, scenarioBody, setMonteCarloId, t],
  );

  const dismiss = useCallback(() => setMonteCarloId(null), [setMonteCarloId]);

  return { runId, run, launch, submitting: isPending, submitError, disabledReason, dismiss };
}
