"use client";

/**
 * ReportHeader — breadcrumb (Runs › {rocket} › run {id}), status pill, the
 * title "{rocket} over {site}" (the scenario's name, else its coordinates),
 * the file · date · author line and the actions (S9, board C).
 *
 * A client island: GET /api/results/{run_id} carries the numbers only, so
 * the rocket, file, author and scenario come from the run's history row
 * (useRunSummaryQuery). While it loads the title area keeps its height;
 * when the run is older than the history page the API serves, the header
 * falls back to the run id and says the details are unavailable.
 */

import Link from "next/link";
import { useRunSummaryQuery } from "@/lib/queries";
import { scenarioFacts, siteLabel } from "@/lib/domain/runs";
import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { textLink } from "@/components/workbench/styles";
import { useRunFormatters } from "@/components/runs/useRunFormatters";
import { ResultsActions } from "./ResultsActions";

const CRUMB = cn(textLink, "text-sm");

export function ReportHeader({ runId }: { runId: string }) {
  const t = useT();
  const { dateTime } = useRunFormatters();
  const summary = useRunSummaryQuery(runId);
  const run = summary.data ?? null;

  const facts = run ? scenarioFacts(run.scenario) : null;
  const site = facts ? (facts.name ?? (facts.site ? siteLabel(facts.site) : null)) : null;
  const title = run
    ? site
      ? t("report.title", { rocket: run.name, site })
      : run.name
    : summary.isPending
      ? " "
      : t("report.titleFallback");

  return (
    <header className="flex flex-col gap-4">
      <nav aria-label={t("report.breadcrumb")} className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <Link href="/runs" className={CRUMB}>
          {t("report.runs")}
        </Link>
        {run && (
          <>
            <span aria-hidden>/</span>
            <Link href={`/runs?rocket_id=${encodeURIComponent(run.rocket_id)}`} className={CRUMB}>
              {run.name}
            </Link>
          </>
        )}
        <span aria-hidden>/</span>
        <span aria-current="page" translate="no" className="font-mono text-[13px] text-ink-2">
          {t("report.runCrumb", { id: runId })}
        </span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="inline-flex items-center gap-1.5 self-start rounded-full bg-ok-soft px-2.5 py-0.5 text-xs font-medium text-ok-ink">
            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-ok" />
            {t("report.statusDone")}
          </span>
          <h1 className="text-balance text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">{title}</h1>
          {run && (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
              <span translate="no" className="font-mono text-[13px] text-ink-2">
                {run.ork_filename ?? run.export_id}
              </span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">{dateTime.format(new Date(run.created_at))}</span>
              <span aria-hidden>·</span>
              <span translate="no">{run.created_by}</span>
            </p>
          )}
          {!run && !summary.isPending && <p className="text-sm text-muted">{t("report.detailsUnavailable")}</p>}
        </div>
        <ResultsActions />
      </div>
    </header>
  );
}
