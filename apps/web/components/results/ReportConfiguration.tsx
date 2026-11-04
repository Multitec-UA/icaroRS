"use client";

/**
 * ReportConfiguration — the run's stored scenario as a definition list (S9,
 * board C): rocket file, site, elevation, launch time, weather model, rail;
 * then the compact card of the rocket the file describes (S7). The scenario lives on the run's
 * history row (useRunSummaryQuery), hence a client island; the facts come
 * from lib/domain/runs so they read the same way as the /runs chips.
 */

import { useId } from "react";
import { useRunSummaryQuery } from "@/lib/queries";
import { scenarioFacts, siteLabel } from "@/lib/domain/runs";
import { cn } from "@/lib/styles";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { formatQuantity } from "@/components/flight/flightMath";
import { useRunFormatters } from "@/components/runs/useRunFormatters";
import { ReportRocketCard } from "./ReportRocketCard";
import { fileLabel } from "@/lib/domain/exports";

const BLOCK = "rounded-md bg-chip motion-safe:animate-pulse";

export function ReportConfiguration({ runId }: { runId: string }) {
  const t = useT();
  const { locale } = useLocale();
  const id = useId();
  const { dateTime, modelLabel } = useRunFormatters();
  const summary = useRunSummaryQuery(runId);
  const run = summary.data ?? null;
  const facts = run ? scenarioFacts(run.scenario) : null;
  const unset = t("runs.unset");

  const rows: { key: string; label: string; value: string; mono?: boolean }[] = facts && run
    ? [
        { key: "file", label: t("report.configFile"), value: fileLabel(run.ork_filename, run.ork_revision, run.export_id), mono: true },
        {
          key: "site",
          label: t("report.configSite"),
          value: facts.site ? siteLabel(facts.site) : unset,
        },
        {
          key: "elevation",
          label: t("report.configElevation"),
          value: facts.site?.elevation != null ? formatQuantity(facts.site.elevation, "m", locale) : unset,
        },
        {
          key: "launch",
          label: t("report.configLaunch"),
          value: facts.launchDateIso ? dateTime.format(new Date(facts.launchDateIso)) : unset,
        },
        { key: "weather", label: t("report.configWeather"), value: facts.model ? modelLabel(facts.model) : unset },
        {
          key: "rail",
          label: t("report.configRail"),
          value: facts.rail
            ? [
                facts.rail.length !== null ? `${facts.rail.length} m` : null,
                facts.rail.inclination !== null ? `${facts.rail.inclination}°` : null,
                facts.rail.heading !== null ? `${facts.rail.heading}°` : null,
              ]
                .filter(Boolean)
                .join(" · ") || unset
            : unset,
        },
      ]
    : [];

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-soft"
    >
      <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">
        {t("report.configuration")}
      </h2>
      {summary.isPending && (
        <div aria-hidden className="flex flex-col gap-3 py-1">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className={cn(BLOCK, "h-4", i % 2 ? "w-2/3" : "w-1/2")} />
          ))}
        </div>
      )}
      {!summary.isPending && !run && <p className="text-sm text-muted">{t("report.detailsUnavailable")}</p>}
      {rows.length > 0 && (
        <dl className="flex flex-col text-sm">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex items-baseline justify-between gap-4 border-t border-divider py-2 first:border-t-0"
            >
              <dt className="text-ink-2">{row.label}</dt>
              <dd
                translate={row.mono ? "no" : undefined}
                className={cn("text-right font-medium text-ink", row.mono ? "font-mono text-[13px]" : "tabular-nums")}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <ReportRocketCard runId={runId} />
    </section>
  );
}
