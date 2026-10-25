"use client";

/**
 * RunsView — the /runs board (S9, canvas board B): one rocket's runs, newest
 * first, with a baseline run, deltas per KPI, up to three runs overlaid in
 * one altitude chart and "What changed" chips per compared run.
 *
 * The rocket comes from `?rocket_id=` (the RocketPanel's "Compare two
 * files" link), else it is the rocket of the org's most recent run. The
 * board below is keyed by rocket, so baseline and selection start fresh
 * whenever the rocket changes. Reads go through lib/queries only.
 */

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SimulationSummary } from "@/lib/api";
import { useHistoryQuery, useRocketsQuery, useSeriesQueries } from "@/lib/queries";
import { plural } from "@/lib/i18n";
import { cn, selectClass } from "@/lib/styles";
import { Callout } from "@/components/ui";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { MAX_OVERLAY } from "./colors";
import { OverlayCard } from "./OverlayCard";
import { RunsSkeleton } from "./RunsSkeleton";
import { RunsTable } from "./RunsTable";
import { WhatChanged } from "./WhatChanged";

/** Runs listed per rocket; the API caps a page at 100. */
const RUNS_PAGE = 50;

export function RunsView() {
  const t = useT();
  const { locale } = useLocale();
  const params = useSearchParams();
  const paramRocket = params.get("rocket_id");
  const rockets = useRocketsQuery();
  const [chosenRocket, setChosenRocket] = useState<string | null>(null);

  // No rocket named anywhere: default to the rocket of the most recent run,
  // and failing that to the first rocket of the org.
  const needsDefault = chosenRocket === null && !paramRocket;
  const latest = useHistoryQuery({ limit: 1, enabled: needsDefault });
  const rocketId =
    chosenRocket ?? paramRocket ?? latest.data?.[0]?.rocket_id ?? rockets.data?.[0]?.rocket_id ?? null;

  const runs = useHistoryQuery({ rocketId, limit: RUNS_PAGE, enabled: rocketId !== null });
  const rocket = rockets.data?.find((r) => r.rocket_id === rocketId) ?? null;
  const rocketName = rocket?.name ?? runs.data?.[0]?.name ?? "";

  if (rockets.isSuccess && rockets.data.length === 0) {
    return <Callout tone="info">{t("runs.noRockets")}</Callout>;
  }
  if (rockets.isError) {
    return <Callout tone="error">{t("rockets.errorLoad")}</Callout>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <label className="flex flex-col gap-1 text-xs font-medium text-muted">
          {t("runs.rocketLabel")}
          <select
            value={rocketId ?? ""}
            onChange={(event) => setChosenRocket(event.target.value)}
            disabled={!rockets.data}
            className={cn(selectClass, "h-9 w-auto min-w-[14rem] rounded-[9px] pr-9 text-ink")}
          >
            {!rockets.data && <option value="">{t("common.loading")}</option>}
            {rockets.data?.map((r) => (
              <option key={r.rocket_id} value={r.rocket_id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        {runs.data && (
          <span className="pb-2 text-sm text-muted">{plural(locale, runs.data.length, "runs.count")}</span>
        )}
      </div>

      {runs.isError && <Callout tone="error">{t("runs.errorLoad")}</Callout>}
      {(runs.isPending && rocketId !== null) || (rocketId === null && !rockets.isError && !latest.isError) ? (
        !runs.data && <RunsSkeleton label={t("runs.loading")} />
      ) : null}
      {runs.isSuccess && runs.data.length === 0 && <Callout tone="info">{t("runs.empty")}</Callout>}
      {runs.data && runs.data.length > 0 && rocketId && (
        <RunsBoard key={rocketId} runs={runs.data} rocketName={rocketName} />
      )}
    </div>
  );
}

/**
 * The board of one rocket: baseline, compare selection, table, overlay and
 * chips. Mounted with `key={rocketId}` so its state belongs to that rocket.
 */
function RunsBoard({ runs, rocketName }: { runs: SimulationSummary[]; rocketName: string }) {
  const [baselineChoice, setBaselineChoice] = useState<string | null>(null);
  const [selectionChoice, setSelectionChoice] = useState<string[] | null>(null);

  // The baseline defaults to the newest finished run; a choice that no longer
  // exists in the list (after a refetch) falls back to that default too.
  const defaultBaseline = runs.find((run) => run.status === "done")?.simulation_id ?? runs[0]?.simulation_id ?? null;
  const baselineId =
    baselineChoice !== null && runs.some((run) => run.simulation_id === baselineChoice)
      ? baselineChoice
      : defaultBaseline;
  // Until the user picks, the baseline alone is overlaid.
  const defaultSelection = baselineId ? [baselineId] : [];
  const selectedIds = (selectionChoice ?? defaultSelection).filter((id) => runs.some((run) => run.simulation_id === id));

  function toggle(runId: string) {
    setSelectionChoice((previous) => {
      const current = previous ?? defaultSelection;
      if (current.includes(runId)) return current.filter((id) => id !== runId);
      return current.length >= MAX_OVERLAY ? current : [...current, runId];
    });
  }

  const byId = new Map(runs.map((run) => [run.simulation_id, run]));
  const baseline = baselineId ? (byId.get(baselineId) ?? null) : null;
  const selectedRuns = selectedIds.map((id) => byId.get(id)).filter((run): run is SimulationSummary => run !== undefined);
  const seriesQueries = useSeriesQueries(selectedIds);
  const colorIndex = (runId: string) => {
    const index = selectedIds.indexOf(runId);
    return index === -1 ? null : index;
  };

  return (
    <>
      <RunsTable
        runs={runs}
        rocketName={rocketName}
        baselineId={baselineId}
        selectedIds={selectedIds}
        colorIndex={colorIndex}
        onBaseline={setBaselineChoice}
        onToggle={toggle}
      />
      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <OverlayCard
          entries={selectedRuns.map((run, index) => ({
            run,
            colorIndex: index,
            series: seriesQueries[index]?.data ?? null,
            pending: seriesQueries[index]?.isPending ?? false,
            missing: seriesQueries[index]?.isError ?? false,
          }))}
        />
        <WhatChanged baseline={baseline} compared={selectedRuns} colorIndex={colorIndex} />
      </div>
    </>
  );
}
