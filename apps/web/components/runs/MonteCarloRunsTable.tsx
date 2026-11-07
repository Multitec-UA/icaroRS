"use client";

/**
 * MonteCarloRunsTable — one rocket's Monte Carlo dispersion runs on /runs
 * (S12), newest first: when it started, its status (with `done / total`
 * flights while running), the flight count, the median apogee once done and
 * the row actions: "View report" (primary, `/results/mc/{id}`), "Open in
 * Workbench" (`/?file={export}&mc={id}`, which resumes or shows it) and, on a
 * finished run that wrote one, "Download KML".
 *
 * The list has no results, so the median apogee and the KML flag of each
 * finished run are read from its own GET (cached with the Workbench's). The
 * list polls while any run is still queued or running. The deterministic
 * table and its compare tools are not involved.
 */

import Link from "next/link";
import { monteCarloKmlUrl, type MonteCarloSummary } from "@/lib/api";
import { useMonteCarloListQuery, useMonteCarloRunQueries } from "@/lib/queries";
import { formatNumber } from "@/components/flight/flightMath";
import { shortRunId } from "@/lib/domain/runs";
import { cn } from "@/lib/styles";
import { Callout, Tooltip, buttonClass } from "@/components/ui";
import { cardClass } from "@/components/ui/classes";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { EyeIcon, PlayIcon } from "@/components/workbench/icons";
import { RunsSkeleton } from "./RunsSkeleton";
import { workbenchMonteCarloHref } from "./OpenInWorkbenchButton";
import { useRunFormatters } from "./useRunFormatters";

const HEAD_CELL = "px-2.5 py-2.5 text-left align-bottom text-xs font-medium text-muted";
const CELL = "px-2.5 py-3 align-top";

const STATUS_KEY: Record<MonteCarloSummary["status"], string> = {
  queued: "montecarlo.statusQueued",
  running: "montecarlo.statusRunning",
  done: "montecarlo.statusDone",
  error: "montecarlo.statusError",
};

export function MonteCarloRunsTable({ rocketId, rocketName }: { rocketId: string; rocketName: string }) {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime } = useRunFormatters();
  const list = useMonteCarloListQuery(rocketId);
  const runs = list.data ?? [];
  const doneIds = runs.filter((run) => run.status === "done").map((run) => run.run_id);
  const details = useMonteCarloRunQueries(doneIds);
  const p50 = new Map(
    doneIds.map((id, index) => [id, details[index]?.data?.result?.apogee_stats?.p50 ?? null] as const),
  );
  const hasKml = new Set(doneIds.filter((_id, index) => Boolean(details[index]?.data?.result?.files.kml)));

  if (list.isError) return <Callout tone="error">{t("runs.mcErrorLoad")}</Callout>;
  if (list.isPending) return <RunsSkeleton label={t("runs.mcLoading")} />;
  if (runs.length === 0) return <Callout tone="info">{t("runs.mcEmpty")}</Callout>;

  return (
    <div className={cn("max-h-[55vh] overflow-auto overscroll-contain", cardClass)}>
      <table className="w-full min-w-[560px] border-collapse text-sm text-ink">
        <caption className="sr-only">{t("runs.mcCaption", { rocket: rocketName })}</caption>
        <thead className="sticky top-0 z-10 bg-surface shadow-[0_1px_0_var(--divider)]">
          <tr className="border-b border-divider">
            <th scope="col" className={HEAD_CELL}>
              {t("runs.mcColStarted")}
            </th>
            <th scope="col" className={HEAD_CELL}>
              {t("runs.mcColStatus")}
            </th>
            <th scope="col" className={cn(HEAD_CELL, "text-right")}>
              {t("runs.mcColFlights")}
            </th>
            <th scope="col" className={cn(HEAD_CELL, "text-right")}>
              {t("runs.mcColApogee")}
            </th>
            <th scope="col" className={cn(HEAD_CELL, "w-px")}>
              <span className="sr-only">{t("runs.colActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const median = p50.get(run.run_id) ?? null;
            const openLabel = t("runs.openInWorkbench");
            const reportLabel = t("runs.viewReport");
            const kmlLabel = t("montecarlo.downloadKml");
            return (
              <tr key={run.run_id} className="border-b border-divider last:border-b-0 hover:bg-surface-2">
                <th scope="row" className={cn(CELL, "text-left font-normal")}>
                  <span className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap tabular-nums">{dateTime.format(new Date(run.created_at))}</span>
                    <span translate="no" title={run.run_id} className="font-mono text-xs text-muted">
                      {shortRunId(run.run_id)}
                    </span>
                  </span>
                </th>
                <td className={cn(CELL, run.status === "error" ? "text-bad-ink" : "text-ink-2")}>
                  <span title={run.error ?? undefined}>
                    {run.status === "running"
                      ? t("montecarlo.progress", { done: run.progress.done, total: run.progress.total })
                      : t(STATUS_KEY[run.status])}
                  </span>
                </td>
                <td className={cn(CELL, "text-right tabular-nums")}>{run.n}</td>
                <td className={cn(CELL, "text-right tabular-nums")}>
                  {median === null ? "—" : formatNumber(median, locale, 0)}
                </td>
                <td className={CELL}>
                  <span className="flex items-center justify-end gap-1">
                    <Tooltip label={reportLabel}>
                      <Link
                        href={`/results/mc/${encodeURIComponent(run.run_id)}`}
                        aria-label={reportLabel}
                        className={buttonClass({ variant: "primary", size: "icon" })}
                      >
                        <EyeIcon />
                      </Link>
                    </Tooltip>
                    <Tooltip label={openLabel} align="end">
                      <Link
                        href={workbenchMonteCarloHref(run.export_id, run.run_id)}
                        aria-label={openLabel}
                        className={buttonClass({ variant: "ghost", size: "icon" })}
                      >
                        <PlayIcon />
                      </Link>
                    </Tooltip>
                    {hasKml.has(run.run_id) && (
                      <Tooltip label={kmlLabel} align="end">
                        <a
                          href={monteCarloKmlUrl(run.run_id)}
                          download
                          aria-label={kmlLabel}
                          className={buttonClass({ variant: "ghost", size: "icon" })}
                        >
                          <DownloadIcon />
                        </a>
                      </Tooltip>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Arrow into a tray: the KML download (same 24-grid, 2px line style as workbench/icons.tsx). */
function DownloadIcon() {
  return (
    <svg
      aria-hidden
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
    </svg>
  );
}
