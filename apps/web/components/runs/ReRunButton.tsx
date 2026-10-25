"use client";

/**
 * ReRunButton — "Re-run" for one run of the table (S9), carried over from
 * the retired history list: submits the stored (export_id, scenario)
 * verbatim to /api/simulate and opens the new run's report. The original
 * simulation is never mutated. Owns its own mutation state so re-running one
 * row never affects another. A failed run cannot be re-run, nor can a run
 * written before the Rocket/Export split (its stored rocket_id is a group,
 * not a file) — the button says why in both cases.
 */

import { useRouter } from "next/navigation";
import { ApiError, type SimulationSummary } from "@/lib/api";
import { useSimulateMutation } from "@/lib/queries";
import { Spinner } from "@/components/ui";
import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { PlayIcon } from "@/components/workbench/icons";
import { ghostButton } from "@/components/workbench/styles";

export function ReRunButton({ run }: { run: SimulationSummary }) {
  const t = useT();
  const router = useRouter();
  const rerun = useSimulateMutation();

  const unavailable = run.status === "error" || !run.export_id;
  const reason = !run.export_id ? t("runs.reRunNoExport") : t("runs.reRunUnavailable");
  const isUnauthorizedError = rerun.error instanceof ApiError && rerun.error.isUnauthorized;
  const hasError = rerun.isError && !isUnauthorizedError;
  const errorStatus = rerun.error instanceof ApiError ? rerun.error.status : 0;

  function handleReRun() {
    if (!run.export_id) return;
    rerun.mutate(
      { exportId: run.export_id, scenario: run.scenario },
      { onSuccess: (result) => router.push(`/results/${encodeURIComponent(result.run_id)}`) },
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        disabled={rerun.isPending || unavailable}
        title={unavailable ? reason : undefined}
        onClick={handleReRun}
        className={cn(ghostButton, "h-8 px-2.5 text-[13px]")}
      >
        {rerun.isPending ? <Spinner decorative className="h-3 w-3" /> : <PlayIcon />}
        {t("runs.reRun")}
        {/* A disabled button gives no reason on its own; say it for assistive tech. */}
        {unavailable && <span className="sr-only">{reason}</span>}
      </button>
      {hasError && (
        <span aria-live="polite" className="text-xs text-bad-ink">
          {t("errors.requestFailed", { status: errorStatus })}
        </span>
      )}
    </span>
  );
}
