"use client";

/**
 * RunsTable — one rocket's runs as a table (S9): a compare checkbox and a
 * baseline radio per row, the run (date, file, id), the launch (date,
 * weather model, site), the four compared numbers with their delta against
 * the baseline and the actions (View report, Open in Workbench). Deltas
 * and metrics come from lib/domain/runs so the chips agree with them.
 *
 * Layout follows common table guidance (NN/g "Data Tables", GOV.UK Design
 * System "Table", Carbon "Data table"): text left-aligned and numbers
 * right-aligned, each like its header; a numeric column's unit sits in its
 * header and every value and delta of a column shares one precision
 * (`METRIC_DECIMALS`) in tabular figures; one primary line per cell with
 * the secondary lines muted; the row actions are icon-only with tooltips,
 * a primary View report and a secondary Workbench, in the same place on every row.
 * Numbers never wrap while their headers may ("Tiempo de vuelo" is wider than any value),
 * the actions column is as narrow as its content (`w-px`, "View report"
 * stacked over "Workbench"), the run's file name truncates, the launch wraps,
 * and a failed run says so inside its run cell (no status column: every
 * other row would only read "Done"). The table fits a 1024 px window; below
 * its min width it scrolls sideways inside its card instead of widening the page.
 */

import { useMemo } from "react";
import type { SimulationSummary } from "@/lib/api";
import {
  RUN_METRIC_KEYS,
  RUN_METRIC_UNITS,
  runDeltas,
  runMetrics,
  scenarioFacts,
  shortRunId,
  siteLabel,
  type RunMetricKey,
} from "@/lib/domain/runs";
import { cn } from "@/lib/styles";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { cardClass } from "@/components/ui/classes";
import { RUN_COLORS } from "./colors";
import { MAX_OVERLAY } from "./colors";
import { OpenInWorkbenchButton, ViewReportButton } from "./OpenInWorkbenchButton";
import { useRunFormatters } from "./useRunFormatters";
import { FileName } from "@/components/ui/FileName";

const METRIC_LABEL_KEYS: Record<RunMetricKey, string> = {
  apogee: "runs.colApogee",
  maxSpeed: "runs.colMaxSpeed",
  flightTime: "runs.colFlightTime",
  landing: "runs.colLanding",
};

/** One precision per column: whole metres and m/s; tenths of a second and of a metre. */
const METRIC_DECIMALS: Record<RunMetricKey, number> = {
  apogee: 0,
  maxSpeed: 0,
  flightTime: 1,
  landing: 1,
};

// Headers sit on the data (bottom-aligned), so a wrapped header still lines up.
const HEAD_CELL = "px-2.5 py-2.5 text-left align-bottom text-xs font-medium text-muted";
const CELL = "px-2.5 py-3 align-top";

export function RunsTable({
  runs,
  rocketName,
  baselineId,
  selectedIds,
  colorIndex,
  onBaseline,
  onToggle,
}: {
  runs: SimulationSummary[];
  rocketName: string;
  baselineId: string | null;
  selectedIds: string[];
  colorIndex: (runId: string) => number | null;
  onBaseline: (runId: string) => void;
  onToggle: (runId: string) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime, modelLabel } = useRunFormatters();
  const limitReached = selectedIds.length >= MAX_OVERLAY;

  const baseline = useMemo(
    () => runs.find((run) => run.simulation_id === baselineId) ?? null,
    [runs, baselineId],
  );
  const baselineMetrics = useMemo(() => (baseline ? runMetrics(baseline.scalars) : null), [baseline]);

  return (
    <div className={cn("overflow-x-auto", cardClass)}>
      <table className="w-full min-w-[760px] border-collapse text-sm text-ink">
        <caption className="sr-only">{t("runs.tableCaption", { rocket: rocketName })}</caption>
        <thead>
          <tr className="border-b border-divider">
            <th scope="col" className={HEAD_CELL}>
              {t("runs.colCompare")}
            </th>
            <th scope="col" className={HEAD_CELL}>
              {t("runs.colBaseline")}
            </th>
            <th scope="col" className={HEAD_CELL}>
              {t("runs.colRun")}
            </th>
            <th scope="col" className={HEAD_CELL}>
              {t("runs.colLaunch")}
            </th>
            {RUN_METRIC_KEYS.map((key) => (
              <th key={key} scope="col" className={cn(HEAD_CELL, "text-right")}>
                {t(METRIC_LABEL_KEYS[key])}{" "}
                <span className="whitespace-nowrap font-normal">({RUN_METRIC_UNITS[key]})</span>
              </th>
            ))}
            <th scope="col" className={cn(HEAD_CELL, "w-px")}>
              <span className="sr-only">{t("runs.colActions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => {
            const id = shortRunId(run.simulation_id);
            const isBaseline = run.simulation_id === baselineId;
            const selected = selectedIds.includes(run.simulation_id);
            const color = colorIndex(run.simulation_id);
            const metrics = runMetrics(run.scalars);
            const deltas = baselineMetrics && !isBaseline ? runDeltas(baselineMetrics, metrics) : null;
            const facts = scenarioFacts(run.scenario);
            const done = run.status === "done";
            return (
              <tr
                key={run.simulation_id}
                className={cn(
                  "border-b border-divider transition-colors duration-200 last:border-b-0 hover:bg-surface-2",
                  isBaseline && "bg-accent-soft/30",
                )}
              >
                <td className={CELL}>
                  <span className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!selected && limitReached}
                      title={!selected && limitReached ? t("runs.selectionLimit", { count: MAX_OVERLAY }) : undefined}
                      aria-label={t("runs.selectRun", { id })}
                      onChange={() => onToggle(run.simulation_id)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--primary)]"
                    />
                    <span
                      aria-hidden
                      className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", color === null ? "bg-transparent" : RUN_COLORS[color].dot)}
                    />
                  </span>
                </td>
                <td className={CELL}>
                  <input
                    type="radio"
                    name="baseline"
                    checked={isBaseline}
                    aria-label={t("runs.baselineRun", { id })}
                    onChange={() => onBaseline(run.simulation_id)}
                    className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
                  />
                </td>
                <th scope="row" className={cn(CELL, "text-left font-normal")}>
                  <span className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap tabular-nums text-ink">{dateTime.format(new Date(run.created_at))}</span>
                    <span title={run.ork_filename ?? undefined} className="block max-w-48 text-xs text-ink-2">
                      <FileName name={run.ork_filename ?? (run.export_id || "—")} revision={run.ork_revision} />
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <span translate="no" title={run.simulation_id} className="font-mono">
                        {id}
                      </span>
                      {isBaseline && (
                        <span className="rounded-full bg-accent-soft px-1.5 py-px text-[11px] font-medium text-accent-ink">
                          {t("runs.baselineTag")}
                        </span>
                      )}
                      {!done && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-bad-soft px-1.5 py-px text-[11px] font-medium text-bad-ink">
                          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-bad" />
                          {t("runs.statusError")}
                        </span>
                      )}
                    </span>
                  </span>
                </th>
                <td className={cn(CELL, "min-w-36 text-ink-2")}>
                  <span className="flex flex-col gap-0.5">
                    <span className="whitespace-nowrap tabular-nums text-ink">
                      {facts.launchDateIso ? dateTime.format(new Date(facts.launchDateIso)) : t("runs.unset")}
                      </span>
                    {facts.model && <span className="text-xs">{modelLabel(facts.model)}</span>}
                    <span className="text-xs text-muted">
                      {facts.site ? siteLabel(facts.site) : t("runs.unset")}
                    </span>
                  </span>
                </td>
                {RUN_METRIC_KEYS.map((key) => (
                  <MetricCell
                    key={key}
                    value={metrics[key]}
                    delta={deltas?.[key] ?? null}
                    decimals={METRIC_DECIMALS[key]}
                    locale={locale}
                  />
                ))}
                <td className={cn(CELL, "w-px whitespace-nowrap text-right")}>
                  <span className="flex items-center justify-end gap-1.5">
                    {done ? (
                      <ViewReportButton runId={run.simulation_id} />
                    ) : (
                      // Keeps the Workbench action in the same place on every row.
                      <span aria-hidden className="w-8" />
                    )}
                    <OpenInWorkbenchButton run={run} />
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

function MetricCell({
  value,
  delta,
  decimals,
  locale,
}: {
  value: number | null;
  delta: number | null;
  decimals: number;
  locale: "en" | "es";
}) {
  const fixed = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
  const shown = value === null || !Number.isFinite(value) ? "—" : value.toLocaleString(locale, fixed);
  return (
    <td className={cn(CELL, "whitespace-nowrap text-right tabular-nums")}>
      <span className="flex flex-col items-end gap-0.5">
        <span className="tabular-nums text-ink">{shown}</span>
        {delta !== null && (
          // Neutral on purpose: a lower apogee is a difference, not an error,
          // and red stays for the brand and for failures.
          <span className="text-xs tabular-nums text-muted">
            {new Intl.NumberFormat(locale, { ...fixed, signDisplay: "exceptZero" }).format(delta)}
          </span>
        )}
      </span>
    </td>
  );
}
