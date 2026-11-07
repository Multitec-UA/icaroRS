"use client";

/**
 * MonteCarloReport — the dispersion report at /results/mc/{run_id}, opened
 * from the /runs "Dispersion" table. It shows what the Workbench card
 * (MonteCarloCard) shows for the same run, without needing its file loaded:
 *
 *   header   breadcrumb (Runs › {rocket} › dispersion {id}), status pill,
 *            "Dispersion · N flights", date · author, "Open in Workbench"
 *   done     MonteCarloResults — the same composition the Workbench renders
 *            (context, reading, explainer, counts, apogee, histogram, map,
 *            and the KML download when the run wrote one)
 *   queued / running / error   a status line, no results
 *
 * The page reads the run on the server and seeds `useMonteCarloQuery` with
 * it, so a queued or running run keeps polling here until it finishes. The
 * run carries only the rocket id: its name comes from the rocket lookup.
 */

import Link from "next/link";
import type { MonteCarloRun } from "@/lib/api";
import { plural } from "@/lib/i18n";
import { progressFraction, queueAhead } from "@/lib/domain/montecarlo";
import { useMonteCarloQuery, useRocketDetailQuery } from "@/lib/queries";
import { cn } from "@/lib/styles";
import { Callout, StatusPill, buttonClass, type Tone } from "@/components/ui";
import { cardClass, textLink } from "@/components/ui/classes";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { useRunFormatters } from "@/components/runs/useRunFormatters";
import { workbenchMonteCarloHref } from "@/components/runs/OpenInWorkbenchButton";
import { PlayIcon } from "@/components/workbench/icons";
import { MonteCarloResults } from "./MonteCarloResults";

const CRUMB = cn(textLink, "text-sm");

const STATUS: Record<MonteCarloRun["status"], { key: string; tone: Tone }> = {
  queued: { key: "montecarlo.statusQueued", tone: "neutral" },
  running: { key: "montecarlo.statusRunning", tone: "warn" },
  done: { key: "montecarlo.statusDone", tone: "ok" },
  error: { key: "montecarlo.statusError", tone: "bad" },
};

export function MonteCarloReport({ runId, initialRun }: { runId: string; initialRun: MonteCarloRun }) {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime } = useRunFormatters();
  const query = useMonteCarloQuery(runId, { initialData: initialRun });
  const run = query.data ?? initialRun;
  const rocket = useRocketDetailQuery(run.rocket_id).data ?? null;
  const status = STATUS[run.status];

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-4">
        <nav aria-label={t("report.breadcrumb")} className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
          <Link href="/runs" className={CRUMB}>
            {t("report.runs")}
          </Link>
          {rocket && (
            <>
              <span aria-hidden>/</span>
              <Link href={`/runs?rocket_id=${encodeURIComponent(run.rocket_id)}`} className={CRUMB}>
                {rocket.name}
              </Link>
            </>
          )}
          <span aria-hidden>/</span>
          <span aria-current="page" translate="no" className="font-mono text-[13px] text-ink-2">
            {t("mcReport.crumb", { id: runId })}
          </span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1.5">
            <StatusPill tone={status.tone} spinner={run.status === "running"} className="self-start">
              {t(status.key)}
            </StatusPill>
            <h1 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
              {t("montecarlo.title", { count: run.n })}
            </h1>
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span className="tabular-nums">{dateTime.format(new Date(run.created_at))}</span>
              <span aria-hidden>·</span>
              <span translate="no">{run.created_by}</span>
            </p>
          </div>
          <Link
            href={workbenchMonteCarloHref(run.export_id, run.run_id)}
            className={buttonClass({ variant: "ghost", className: "gap-2" })}
          >
            <PlayIcon />
            {t("runs.openInWorkbench")}
          </Link>
        </div>
      </header>

      <section aria-label={t("montecarlo.panelLabel")} className={cn(cardClass, "flex flex-col gap-4 p-5")}>
        {run.status === "queued" && (
          <p className="text-sm text-ink-2">
            {queueAhead(run.queue_position) > 0
              ? plural(locale, queueAhead(run.queue_position), "montecarlo.queueAhead")
              : t("montecarlo.queueNext")}
          </p>
        )}

        {run.status === "running" && (
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

        {run.status === "error" && <Callout tone="error">{run.error || t("montecarlo.errorFallback")}</Callout>}

        {run.status === "done" &&
          (run.result ? (
            <MonteCarloResults runId={runId} result={run.result} />
          ) : (
            <Callout tone="warning">{t("mcReport.noResult")}</Callout>
          ))}
      </section>
    </div>
  );
}
