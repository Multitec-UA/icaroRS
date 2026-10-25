"use client";

/**
 * RunsTable — one rocket's runs as a table (S9): a compare checkbox and a
 * baseline radio per row, the run (date, file, id), the launch (date,
 * weather model, site), the four compared numbers with their delta against
 * the baseline, the status and the actions (View report, Re-run). Deltas
 * and metrics come from lib/domain/runs so the chips agree with them.
 */

import Link from "next/link";
import { useMemo } from "react";
import type { SimulationSummary } from "@/lib/api";
import {
  RUN_METRIC_KEYS,
  RUN_METRIC_UNITS,
  formatDelta,
  runDeltas,
  runMetrics,
  scenarioFacts,
  shortRunId,
  siteLabel,
  type RunMetricKey,
} from "@/lib/domain/runs";
import { formatScalar } from "@/lib/scalars";
import { cn } from "@/lib/styles";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { textLink } from "@/components/workbench/styles";
import { RUN_COLORS } from "./colors";
import { MAX_OVERLAY } from "./colors";
import { ReRunButton } from "./ReRunButton";
import { useRunFormatters } from "./useRunFormatters";

const METRIC_LABEL_KEYS: Record<RunMetricKey, string> = {
  apogee: "runs.colApogee",
  maxSpeed: "runs.colMaxSpeed",
  flightTime: "runs.colFlightTime",
  landing: "runs.colLanding",
};

const HEAD_CELL = "px-3 py-2.5 text-left text-xs font-medium text-muted";
const CELL = "px-3 py-3 align-top";

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
    <div className="overflow-x-auto rounded-2xl border border-border bg-surface shadow-soft">
      <table className="w-full min-w-[1040px] border-collapse text-sm text-ink">
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
                {t(METRIC_LABEL_KEYS[key])}
              </th>
            ))}
            <th scope="col" className={HEAD_CELL}>
              {t("runs.colStatus")}
            </th>
            <th scope="col" className={HEAD_CELL}>
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
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={!selected && limitReached}
                      title={!selected && limitReached ? t("runs.selectionLimit", { count: MAX_OVERLAY }) : undefined}
                      aria-label={t("runs.selectRun", { id })}
                      onChange={() => onToggle(run.simulation_id)}
                      className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                    />
                    <span
                      aria-hidden
                      className={cn("h-2 w-2 shrink-0 rounded-full", color === null ? "bg-transparent" : RUN_COLORS[color].dot)}
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
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                </td>
                <th scope="row" className={cn(CELL, "font-normal")}>
                  <span className="flex flex-col gap-0.5">
                    <span className="tabular-nums text-ink">{dateTime.format(new Date(run.created_at))}</span>
                    <span translate="no" className="truncate font-mono text-[13px] text-ink-2">
                      {run.ork_filename ?? (run.export_id || "—")}
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
                    </span>
                  </span>
                </th>
                <td className={cn(CELL, "text-ink-2")}>
                  <span className="flex flex-col gap-0.5">
                    <span className="tabular-nums">
                      {facts.launchDateIso ? dateTime.format(new Date(facts.launchDateIso)) : t("runs.unset")}
                      {facts.model && ` · ${modelLabel(facts.model)}`}
                    </span>
                    <span className="text-xs text-muted">
                      {facts.name ?? (facts.site ? siteLabel(facts.site) : t("runs.unset"))}
                    </span>
                  </span>
                </td>
                {RUN_METRIC_KEYS.map((key) => (
                  <MetricCell
                    key={key}
                    value={metrics[key]}
                    delta={deltas?.[key] ?? null}
                    unit={RUN_METRIC_UNITS[key]}
                    locale={locale}
                  />
                ))}
                <td className={CELL}>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
                      done ? "bg-ok-soft text-ok-ink" : "bg-bad-soft text-bad-ink",
                    )}
                  >
                    <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", done ? "bg-ok" : "bg-bad")} />
                    {done ? t("runs.statusDone") : t("runs.statusError")}
                  </span>
                </td>
                <td className={cn(CELL, "text-right")}>
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    {done && (
                      <Link href={`/results/${encodeURIComponent(run.simulation_id)}`} className={textLink}>
                        {t("runs.viewReport")}
                      </Link>
                    )}
                    <ReRunButton run={run} />
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
  unit,
  locale,
}: {
  value: number | null;
  delta: number | null;
  unit: string;
  locale: "en" | "es";
}) {
  return (
    <td className={cn(CELL, "text-right tabular-nums")}>
      <span className="flex flex-col items-end gap-0.5">
        <span className="text-ink">{formatScalar(value, unit, locale)}</span>
        {delta !== null && (
          <span
            className={cn(
              "text-xs",
              delta > 0 ? "text-ok-ink" : delta < 0 ? "text-bad-ink" : "text-muted",
            )}
          >
            {formatDelta(delta, locale, unit)}
          </span>
        )}
      </span>
    </td>
  );
}
