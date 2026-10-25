"use client";

/**
 * SeriesPanel — the series chart in a card titled by the active metric, with
 * the metrics as segmented tabs (S9). The chart is the existing SeriesChart
 * in controlled mode, so there is exactly one set of tabs, and its palette
 * follows the theme tokens. Arrow keys move between tabs (roving tabindex);
 * the panel is the tab panel.
 */

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import dynamic from "next/dynamic";
import type { FlightSeries } from "@/lib/api";
import type { MetricKey } from "@/components/charts/SeriesChart";
import { Spinner } from "@/components/ui";
import { cn, focusRing } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { useThemeTokens } from "./useThemeTokens";

const METRICS: { key: MetricKey; labelKey: string }[] = [
  { key: "altitude", labelKey: "chart.altitude" },
  { key: "speed", labelKey: "chart.speed" },
  { key: "mach", labelKey: "chart.mach" },
  { key: "acceleration", labelKey: "chart.acceleration" },
];

// echarts never runs during SSR and stays code-split (same as /results).
const SeriesChart = dynamic(
  () => import("@/components/charts/SeriesChart").then((m) => m.SeriesChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[360px] items-center justify-center text-muted">
        <Spinner />
      </div>
    ),
  },
);

export function SeriesPanel({ series }: { series: FlightSeries }) {
  const t = useT();
  const id = useId();
  const available = METRICS.filter(
    (m) => Array.isArray(series[m.key]) && (series[m.key] as number[]).length > 0,
  );
  const [metric, setMetric] = useState<MetricKey>(available[0]?.key ?? "altitude");

  const tokens = useThemeTokens(
    ["accent", "peach", "ok", "bad", "ink", "muted", "divider", "axis", "surface", "border"] as const,
  );
  const palette = useMemo(
    () => ({
      altitude: tokens.accent,
      speed: tokens.peach,
      mach: tokens.ok,
      acceleration: tokens.bad,
      ink: tokens.ink,
      muted: tokens.muted,
      divider: tokens.divider,
      axis: tokens.axis,
      surface: tokens.surface,
      border: tokens.border,
    }),
    [tokens],
  );

  if (available.length === 0) return null;
  const active = available.find((m) => m.key === metric) ?? available[0];

  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = available.length - 1;
    const next =
      e.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : e.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : e.key === "Home" ? 0
      : e.key === "End" ? last
      : null;
    if (next === null) return;
    e.preventDefault();
    setMetric(available[next].key);
    const tab = e.currentTarget.parentElement?.children.item(next);
    if (tab instanceof HTMLElement) tab.focus();
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-2xl border border-border bg-surface shadow-soft"
    >
      <div className="flex flex-wrap items-center gap-3 px-4 pt-3.5">
        <h3 id={`${id}-title`} className="text-sm font-semibold text-ink">
          {t(active.labelKey)}
        </h3>
        <div role="tablist" aria-label={t("flight.seriesTabs")} className="ml-auto flex flex-wrap gap-1">
          {available.map((m, index) => {
            const selected = m.key === active.key;
            return (
              <button
                key={m.key}
                type="button"
                role="tab"
                id={`${id}-tab-${m.key}`}
                aria-selected={selected}
                aria-controls={`${id}-panel`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setMetric(m.key)}
                onKeyDown={(e) => onTabKeyDown(e, index)}
                className={cn(
                  "h-[30px] rounded-full px-3 text-sm transition-[background-color,color] duration-300 ease-[var(--ease-spring)]",
                  focusRing,
                  selected ? "bg-accent-soft font-medium text-accent-ink" : "bg-chip text-ink-2 hover:text-ink",
                )}
              >
                {t(m.labelKey)}
              </button>
            );
          })}
        </div>
      </div>
      <div
        id={`${id}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-tab-${active.key}`}
        className="px-2 pb-2"
      >
        <SeriesChart series={series} metric={active.key} onMetricChange={setMetric} palette={palette} />
      </div>
    </section>
  );
}
