"use client";

/**
 * HistoryList — reverse-chronological simulation history.
 *
 * Fetches GET /api/history and renders each entry as a self-contained bento
 * card (Ethereal Glass / Double-Bezel, via Card from ui.tsx). Every datum
 * carries its own label — no disconnected header row.
 *
 * "Re-run" triggers re-launch flow A: submits the stored (rocket_id, scenario)
 * verbatim to /api/simulate and navigates to the new result page — the
 * original simulation document is NOT mutated.
 */

import { useRouter } from "next/navigation";
import { ApiError, type SimulationSummary } from "@/lib/api";
import { useHistoryQuery, useSimulateMutation } from "@/lib/queries";
import { Button, Callout, Card, Eyebrow, Spinner } from "@/components/ui";
import { cn } from "@/lib/styles";
import { CountUp, Reveal } from "@/components/motion";
import { useT } from "@/components/i18n/LocaleProvider";

export function HistoryList() {
  const t = useT();
  const { data: items, isLoading: loading, error: queryError } = useHistoryQuery();

  // A 401 is handled globally (lib/query-client.ts); any other error shows a
  // generic load-failure message, same as before.
  const isUnauthorizedError = queryError instanceof ApiError && queryError.isUnauthorized;
  const error = queryError && !isUnauthorizedError ? t("history.errorLoad") : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("history.eyebrow")}</Eyebrow>
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("history.heading")}
        </h1>
        <p className="text-sm text-muted">{t("history.description")}</p>
      </header>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-20 text-muted">
          <Spinner />
          {t("history.loading")}
        </div>
      )}

      {!loading && error && (
        <Callout tone="error">{error}</Callout>
      )}

      {!loading && !error && items?.length === 0 && (
        <Callout tone="info">{t("history.empty")}</Callout>
      )}

      {!loading && !error && items && items.length > 0 && (
        <div className="flex flex-col gap-4">
          {items.map((item, i) => (
            <Reveal key={item.simulation_id} delay={i * 0.04}>
              <HistoryCard item={item} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One history entry, including its own independent "Re-run" mutation state —
 * each card owns its own useMutation call so re-running one entry never
 * affects the running/error state shown on any other.
 */
function HistoryCard({ item }: { item: SimulationSummary }) {
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
  );
}
