"use client";

/**
 * WhatChanged — per compared run, the inputs that differ from the baseline
 * (S9): site, launch time, weather model, rail, uncertainty spread and the
 * file. The diff is lib/domain/runs's `whatChanged`; this only labels and
 * formats it. A compared run with no differences says so, and the baseline
 * is never compared with itself.
 */

import { useId } from "react";
import type { SimulationSummary } from "@/lib/api";
import { shortRunId, whatChanged, type RunChange } from "@/lib/domain/runs";
import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { RUN_COLORS } from "./colors";
import { useRunFormatters } from "./useRunFormatters";

export function WhatChanged({
  baseline,
  compared,
  colorIndex,
}: {
  baseline: SimulationSummary | null;
  compared: SimulationSummary[];
  colorIndex: (runId: string) => number | null;
}) {
  const t = useT();
  const id = useId();
  const { dateTime, modelLabel } = useRunFormatters();
  const others = baseline ? compared.filter((run) => run.simulation_id !== baseline.simulation_id) : [];

  const unset = t("runs.unset");
  const describe = (change: RunChange): string => {
    const from = change.from ?? unset;
    const to = change.to ?? unset;
    switch (change.key) {
      case "site":
        return t("runs.changeSite", { from, to });
      case "launchDate":
        return t("runs.changeLaunchDate", {
          from: change.from ? dateTime.format(new Date(change.from)) : unset,
          to: change.to ? dateTime.format(new Date(change.to)) : unset,
        });
      case "atmosphere":
        return t("runs.changeAtmosphere", {
          from: change.from ? modelLabel(change.from) : unset,
          to: change.to ? modelLabel(change.to) : unset,
        });
      case "railLength":
        return t("runs.changeRailLength", {
          from: change.from ? `${change.from} m` : unset,
          to: change.to ? `${change.to} m` : unset,
        });
      case "railInclination":
        return t("runs.changeRailInclination", {
          from: change.from ? `${change.from}°` : unset,
          to: change.to ? `${change.to}°` : unset,
        });
      case "railHeading":
        return t("runs.changeRailHeading", {
          from: change.from ? `${change.from}°` : unset,
          to: change.to ? `${change.to}°` : unset,
        });
      case "uncertainty":
        return t("runs.changeUncertainty");
      case "file":
        return t("runs.changeFile", { to });
    }
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-soft"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">
          {t("runs.whatChanged")}
        </h2>
        <span className="text-xs text-muted">{t("runs.whatChangedHint")}</span>
      </div>

      {others.length === 0 ? (
        <p className="text-sm text-muted">{t("runs.whatChangedEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {others.map((run) => {
            const changes = baseline ? whatChanged(baseline, run) : [];
            const color = colorIndex(run.simulation_id);
            return (
              <li key={run.simulation_id} className="flex flex-col gap-1.5">
                <span className="flex items-center gap-2 text-[13px] text-ink">
                  <span
                    aria-hidden
                    className={cn("h-2 w-2 shrink-0 rounded-full", color === null ? "bg-chip" : RUN_COLORS[color].dot)}
                  />
                  <span translate="no" className="truncate font-mono">
                    {`${run.ork_filename ?? run.export_id} · ${shortRunId(run.simulation_id)}`}
                  </span>
                </span>
                {changes.length === 0 ? (
                  <span className="pl-4 text-xs text-muted">{t("runs.noChanges")}</span>
                ) : (
                  <ul className="flex flex-wrap gap-1.5 pl-4">
                    {changes.map((change) => (
                      <li
                        key={change.key}
                        className="rounded-full bg-chip px-2.5 py-0.5 text-xs text-ink-2"
                      >
                        {describe(change)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
