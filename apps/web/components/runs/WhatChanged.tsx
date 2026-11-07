"use client";

/**
 * WhatChanged — per compared run, the inputs that differ from the baseline
 * (S9, S12a): file, site (coordinates, elevation), launch time, weather
 * (model, fallback, station) and rail. The diff is lib/domain/runs's
 * `whatChanged`, built on the same canonical `scenarioDiff` as the
 * Workbench status; this only labels and formats it. A compared run with no differences says so, and the baseline
 * is never compared with itself.
 */

import { useId, type ReactNode } from "react";
import type { SimulationSummary } from "@/lib/api";
import { shortRunId, whatChanged, type ChangeGroup, type RunChange } from "@/lib/domain/runs";
import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import { RUN_COLORS } from "./colors";
import { useRunFormatters } from "./useRunFormatters";
import { fileLabel } from "@/lib/domain/exports";

/** The chip label of each input group, shared with the Workbench status (TopBar). */
export const CHANGE_GROUP_LABEL = {
  file: "runs.groupFile",
  site: "runs.groupSite",
  date: "runs.groupDate",
  weather: "runs.groupWeather",
  rail: "runs.groupRail",
} as const satisfies Record<ChangeGroup, string>;

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

  const { system, format, label } = useUnits();
  const unset = t("runs.unset");
  /** A stored length (`"12"`, metres) as the run recorded it; converted only in imperial. */
  const length = (raw: string | null) => {
    if (!raw) return unset;
    // Metric keeps the stored text untouched ("12 m", never re-rounded).
    if (system === "metric") return `${raw} ${label("length")}`;
    const metres = Number(raw);
    return Number.isFinite(metres) ? format(metres, "length") : `${raw} ${label("length")}`;
  };
  const describe = (change: RunChange): string => {
    const from = change.from ?? unset;
    const to = change.to ?? unset;
    switch (change.key) {
      case "site":
        return t("runs.changeSite", { from, to });
      case "elevation":
        return t("runs.changeElevation", { from: length(change.from), to: length(change.to) });
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
      case "fallback":
        return t("runs.changeFallback", {
          from: change.from ? modelLabel(change.from) : unset,
          to: change.to ? modelLabel(change.to) : unset,
        });
      case "station":
        return t("runs.changeStation", { from, to });
      case "railLength":
        return t("runs.changeRailLength", { from: length(change.from), to: length(change.to) });
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
      case "file":
        return t("runs.changeFile", { to });
      case "other":
        return t("runs.changeOther", { group: t(CHANGE_GROUP_LABEL[change.group]) });
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
                    {`${fileLabel(run.ork_filename, run.ork_revision, run.export_id)} · ${shortRunId(run.simulation_id)}`}
                  </span>
                </span>
                {changes.length === 0 ? (
                  <span className="pl-4 text-xs text-muted">{t("runs.noChanges")}</span>
                ) : (
                  <ul className="flex flex-wrap gap-1.5 pl-4">
                    {changes.map((change) => (
                      <ChangeChip key={`${change.group}-${change.key}`}>{describe(change)}</ChangeChip>
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

/**
 * One "what changed" chip, as a list item. The /runs comparison uses the
 * neutral look with the full change; the Workbench status (S6) uses the warn
 * look with the group name only. One component, so both read alike.
 */
export function ChangeChip({ tone = "neutral", children }: { tone?: "neutral" | "warn"; children: ReactNode }) {
  return (
    <li
      className={cn(
        "rounded-full px-2.5 py-0.5 text-xs",
        tone === "warn" ? "bg-warn-soft font-medium text-warn-ink" : "bg-chip text-ink-2",
      )}
    >
      {children}
    </li>
  );
}
