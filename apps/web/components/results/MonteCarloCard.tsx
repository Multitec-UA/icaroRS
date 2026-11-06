"use client";

/**
 * MonteCarloCard — the dispersion run on screen in the Workbench's results
 * column (S12). Presentational: the run comes from the polling status query
 * (`useMonteCarloQuery`), its id from the Workbench URL (`mc=`).
 *
 *   queued   "Queued" + "Waiting behind N runs" (or "Starting shortly")
 *   running  "Running" + a progress bar and "done / total flights"
 *   done     "Done" + MonteCarloResults (counts, apogee, histogram, map, KML)
 *   error    "Failed" + the API's message
 *
 * A run the API no longer has (404) or that could not be read says so; the
 * close button takes the run off screen (it stays listed on /runs).
 */

import { ApiError, type MonteCarloRun } from "@/lib/api";
import { plural } from "@/lib/i18n";
import { progressFraction, queueAhead } from "@/lib/domain/montecarlo";
import { cn, focusRing } from "@/lib/styles";
import { Callout, Spinner, StatusPill, type Tone } from "@/components/ui";
import { cardClass } from "@/components/ui/classes";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { MonteCarloResults } from "./MonteCarloResults";

const STATUS: Record<MonteCarloRun["status"], { key: string; tone: Tone }> = {
  queued: { key: "montecarlo.statusQueued", tone: "neutral" },
  running: { key: "montecarlo.statusRunning", tone: "warn" },
  done: { key: "montecarlo.statusDone", tone: "ok" },
  error: { key: "montecarlo.statusError", tone: "bad" },
};

export interface MonteCarloCardProps {
  runId: string;
  run: MonteCarloRun | undefined;
  loading: boolean;
  error: unknown;
  onDismiss: () => void;
}

export function MonteCarloCard({ runId, run, loading, error, onDismiss }: MonteCarloCardProps) {
  const t = useT();
  const { locale } = useLocale();
  const status = run ? STATUS[run.status] : null;

  return (
    <section aria-label={t("montecarlo.panelLabel")} className={cn(cardClass, "flex flex-col gap-4 p-5")}>
      <header className="flex items-center gap-3">
        <h2 className="text-sm font-semibold text-ink">
          {t("montecarlo.title", { count: run?.n ?? "…" })}
        </h2>
        {status && (
          <StatusPill tone={status.tone} spinner={run?.status === "running"}>
            {t(status.key)}
          </StatusPill>
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t("montecarlo.dismiss")}
          title={t("montecarlo.dismiss")}
          className={cn("grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink", focusRing)}
        >
          <svg aria-hidden width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {!run && loading && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner decorative className="h-3.5 w-3.5" />
          {t("montecarlo.loading")}
        </p>
      )}
      {!run && !loading && error != null && (
        <Callout tone="warning">
          {error instanceof ApiError && error.status === 404 ? t("montecarlo.missing") : t("montecarlo.loadFailed")}
        </Callout>
      )}

      {run?.status === "queued" && (
        <p className="text-sm text-ink-2">
          {queueAhead(run.queue_position) > 0
            ? plural(locale, queueAhead(run.queue_position), "montecarlo.queueAhead")
            : t("montecarlo.queueNext")}
        </p>
      )}

      {run?.status === "running" && (
        <div className="flex flex-col gap-2">
          <div
            role="progressbar"
            aria-label={t("montecarlo.progressLabel")}
            aria-valuemin={0}
            aria-valuemax={run.progress.total}
            aria-valuenow={run.progress.done}
            className="h-2 overflow-hidden rounded-full bg-chip"
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-500 ease-[var(--ease-spring)]"
              style={{ width: `${progressFraction(run.progress) * 100}%` }}
            />
          </div>
          <p className="text-sm tabular-nums text-ink-2">
            {t("montecarlo.progress", { done: run.progress.done, total: run.progress.total })}
          </p>
        </div>
      )}

      {run?.status === "error" && <Callout tone="error">{run.error || t("montecarlo.errorFallback")}</Callout>}

      {run?.status === "done" && run.result && <MonteCarloResults runId={runId} result={run.result} />}
    </section>
  );
}
