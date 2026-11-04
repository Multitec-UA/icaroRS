"use client";

/**
 * OverlayCard — the altitude of the selected runs in one chart (S9): the
 * card chrome (title, "{n} runs overlaid", legend by file name + short run
 * id) around the SVG OverlayChart. Runs whose series are still loading or
 * missing (404) are named below the chart rather than drawn.
 */

import { useId } from "react";
import type { FlightSeries, SimulationSummary } from "@/lib/api";
import { plural } from "@/lib/i18n";
import { shortRunId } from "@/lib/domain/runs";
import { cn } from "@/lib/styles";
import { OverlayChart, type OverlayLine } from "@/components/flight/OverlayChart";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { RUN_COLORS } from "./colors";

export interface OverlayEntry {
  run: SimulationSummary;
  colorIndex: number;
  series: FlightSeries | null;
  pending: boolean;
  missing: boolean;
}

function labelOf(run: SimulationSummary): string {
  return `${run.ork_filename ?? run.export_id} · ${shortRunId(run.simulation_id)}`;
}

export function OverlayCard({ entries }: { entries: OverlayEntry[] }) {
  const t = useT();
  const { locale } = useLocale();
  const id = useId();

  const lines: OverlayLine[] = entries
    .filter((entry) => entry.series && Array.isArray(entry.series.altitude) && entry.series.altitude.length > 1)
    .map((entry) => ({
      id: entry.run.simulation_id,
      label: labelOf(entry.run),
      color: RUN_COLORS[entry.colorIndex].token,
      t: (entry.series as FlightSeries).t,
      values: (entry.series as FlightSeries).altitude as number[],
    }));
  const missing = entries.filter((entry) => entry.missing);
  const pending = entries.some((entry) => entry.pending);

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-soft"
    >
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 id={`${id}-title`} className="text-sm font-semibold text-ink">
          {t("runs.overlayTitle")}
        </h2>
        <span className="text-xs text-muted">{plural(locale, lines.length, "runs.overlayCount")}</span>
      </div>

      {entries.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted">{t("runs.overlayEmpty")}</p>
      ) : (
        <>
          <OverlayChart lines={lines} />
          <ul aria-label={t("runs.overlayLegend")} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
            {entries.map((entry) => (
              <li key={entry.run.simulation_id} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", RUN_COLORS[entry.colorIndex].dot)} />
                <span translate="no" className="font-mono">
                  {labelOf(entry.run)}
                </span>
              </li>
            ))}
          </ul>
          {pending && (
            <p role="status" className="text-xs text-muted">
              {t("flight.loadingSeries")}
            </p>
          )}
          {missing.map((entry) => (
            <p key={entry.run.simulation_id} className="text-xs text-muted">
              {t("runs.overlayNoSeries", { run: labelOf(entry.run) })}
            </p>
          ))}
        </>
      )}
    </section>
  );
}
