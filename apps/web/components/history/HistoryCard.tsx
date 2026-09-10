"use client";

/**
 * One simulation-history entry — the interactive island inside the
 * server-rendered /history list (issue #52). Extracted out of
 * HistoryList.tsx so a Server Component can render the (static) list shell
 * and drop this in per row.
 *
 * "Re-run" triggers re-launch flow A: submits the stored (rocket_id,
 * scenario) verbatim to /api/simulate and navigates to the new result page —
 * the original simulation document is NOT mutated. Owns its own mutation
 * state (issue #48) so re-running one entry never affects any other card.
 */

import { useRouter } from "next/navigation";
import { ApiError, type SimulationSummary } from "@/lib/api";
import { useSimulateMutation } from "@/lib/queries";
import { Button, Card, Spinner } from "@/components/ui";
import { cn } from "@/lib/styles";
import { CountUp, Reveal } from "@/components/motion";
import { useT } from "@/components/i18n/LocaleProvider";

export function HistoryCard({ item, index = 0 }: { item: SimulationSummary; index?: number }) {
  const t = useT();
  const router = useRouter();
  const rerun = useSimulateMutation();

  const apogee = item.scalars?.["apogee"];
  const apogeeFinite = typeof apogee === "number" && Number.isFinite(apogee);

  const isRunning = rerun.isPending;
  const isUnauthorizedError = rerun.error instanceof ApiError && rerun.error.isUnauthorized;
  const hasError = rerun.isError && !isUnauthorizedError;
  const errorHttpStatus = rerun.error instanceof ApiError ? rerun.error.status : 0;

  function handleReRun() {
    rerun.mutate(
      { exportId: item.rocket_id, scenario: item.scenario },
      {
        onSuccess: (result) => router.push(`/results/${encodeURIComponent(result.run_id)}`),
      },
    );
  }

  return (
    <Reveal delay={index * 0.04}>
      <Card innerClassName="flex flex-col gap-5 p-5 sm:p-6">
        {/* Top row: name + status chip */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="text-base font-medium text-foreground">{item.name}</span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium",
              item.status === "done"
                ? "bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/25"
                : "bg-rose-400/10 text-rose-400 ring-1 ring-rose-400/25",
            )}
          >
            {item.status === "done" ? t("history.statusDone") : t("history.statusError")}
          </span>
        </div>

        {/* Metadata: labeled pairs */}
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {/* Apogeo */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {t("history.colApogee")}
            </span>
            <span className="tabular-readout text-sm text-foreground">
              {apogeeFinite ? (
                <CountUp value={apogee as number} format={(n) => Math.round(n).toLocaleString()} />
              ) : (
                "—"
              )}
            </span>
          </div>

          {/* Fecha */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {t("history.colDate")}
            </span>
            <span className="tabular-readout text-sm text-foreground">
              {new Date(item.created_at).toLocaleString([], {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </div>

        {/* Re-run error inline */}
        {hasError && (
          <p className="text-xs text-rose-400">
            {t("errors.requestFailed", { status: errorHttpStatus })}
          </p>
        )}

        {/* Action row */}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            withArrow={!isRunning}
            disabled={isRunning || item.status === "error"}
            onClick={handleReRun}
          >
            {isRunning && <Spinner className="text-cyan-400" />}
            {t("history.reRun")}
          </Button>
        </div>
      </Card>
    </Reveal>
  );
}
