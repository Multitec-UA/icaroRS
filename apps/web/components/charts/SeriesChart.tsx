"use client";

/**
 * SeriesChart — interactive 2D flight chart (issue #11).
 *
 * One metric at a time (altitude / speed / Mach / acceleration) vs time, with
 * hover tooltip, zoom + pan (mouse wheel and a slider). ECharts, themed from
 * the theme tokens. Client-only; meant to be dynamically imported
 * (ssr:false) so echarts never runs during SSR and stays code-split.
 *
 * The canvas itself is opaque to assistive tech, so the container carries an
 * accessible name that summarizes the selected series (metric + peak); the
 * metric toggles expose their state with `aria-pressed`.
 *
 * Two modes (S9): uncontrolled (default) owns the active metric and renders
 * its own toggles; controlled (`metric` + `onMetricChange`, the Workbench's
 * SeriesPanel) follows the parent's metric and leaves the toggles to it, so
 * the chart never shows two sets. `palette` recolours the chart from the
 * caller's colours; the defaults read the theme tokens (`useChartTokens`).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import * as echarts from "echarts";
import { useReducedMotion } from "motion/react";
import type { FlightSeries } from "@/lib/api";
import type { Locale, TranslateFn } from "@/lib/i18n";
import { cn, focusRing } from "@/lib/styles";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { mergePalette, useChartTokens } from "./themeDefaults";

export type MetricKey = "altitude" | "speed" | "mach" | "acceleration";

/** Chart colours; ECharts needs concrete strings, not CSS variables. */
export type SeriesChartPalette = Partial<
  Record<MetricKey | "ink" | "muted" | "divider" | "axis" | "surface" | "border", string>
>;

function tokenPalette(tokens: ReturnType<typeof useChartTokens>): Required<SeriesChartPalette> {
  return {
    altitude: tokens.accent,
    speed: tokens.peach,
    mach: tokens.ok,
    acceleration: tokens.warn,
    ink: tokens.ink,
    muted: tokens.muted,
    divider: tokens.divider,
    axis: tokens.axis,
    surface: tokens.surface,
    border: tokens.border,
  };
}

const METRICS: { key: MetricKey; labelKey: string; unit: string }[] = [
  { key: "altitude", labelKey: "chart.altitude", unit: "m" },
  { key: "speed", labelKey: "chart.speed", unit: "m/s" },
  { key: "mach", labelKey: "chart.mach", unit: "" },
  { key: "acceleration", labelKey: "chart.acceleration", unit: "m/s²" },
];

/** `#rrggbb` + alpha byte; any other colour notation is returned untouched. */
function withAlpha(color: string, alphaHex: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alphaHex}` : color;
}

function buildOption(
  series: FlightSeries,
  metric: (typeof METRICS)[number],
  {
    t,
    format,
    reduceMotion,
    colors,
  }: {
    t: TranslateFn;
    format: Intl.NumberFormat;
    reduceMotion: boolean;
    colors: Required<SeriesChartPalette>;
  },
): echarts.EChartsCoreOption {
  const ys = (series[metric.key] ?? []) as number[];
  const data = series.t.map((t, i) => [t, ys[i]]);
  const label = t(metric.labelKey);
  const lineColor = colors[metric.key];
  const axisColor = colors.axis;
  const splitColor = colors.divider;
  const muted = colors.muted;

  return {
    backgroundColor: "transparent",
    grid: { left: 60, right: 24, top: 24, bottom: 72 },
    tooltip: {
      trigger: "axis",
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 1,
      textStyle: { color: colors.ink, fontSize: 12 },
      axisPointer: { lineStyle: { color: axisColor } },
      formatter: (params: unknown) => {
        const p = (params as { value: [number, number] }[])[0];
        const u = metric.unit ? ` ${metric.unit}` : "";
        return `t = ${format.format(p.value[0])} s<br/><b>${label}: ${format.format(p.value[1])}${u}</b>`;
      },
    },
    xAxis: {
      type: "value",
      name: t("chart.timeAxis"),
      nameLocation: "middle",
      nameGap: 34,
      nameTextStyle: { color: muted },
      axisLine: { lineStyle: { color: axisColor } },
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: splitColor } },
    },
    yAxis: {
      type: "value",
      name: metric.unit ? `${label} (${metric.unit})` : label,
      nameTextStyle: { color: muted },
      scale: true,
      axisLine: { lineStyle: { color: axisColor } },
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: splitColor } },
    },
    dataZoom: [
      { type: "inside" },
      {
        type: "slider",
        height: 20,
        bottom: 28,
        borderColor: "transparent",
        backgroundColor: splitColor,
        fillerColor: withAlpha(lineColor, "1f"),
        handleStyle: { color: lineColor, borderColor: lineColor },
        moveHandleStyle: { color: lineColor },
        dataBackground: { lineStyle: { color: muted }, areaStyle: { color: splitColor } },
        textStyle: { color: muted },
      },
    ],
    series: [
      {
        type: "line",
        smooth: true,
        showSymbol: false,
        data,
        lineStyle: { color: lineColor, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: withAlpha(lineColor, "55") },
            { offset: 1, color: withAlpha(lineColor, "00") },
          ]),
        },
      },
    ],
    // The draw-in animation is skipped for users who asked for less motion.
    animation: !reduceMotion,
    animationDuration: 600,
    animationEasing: "cubicOut",
  };
}

/** Peak of a series, formatted for the accessible name ("—" when empty). */
function formatPeak(values: number[], format: Intl.NumberFormat): string {
  const finite = values.filter((v) => Number.isFinite(v));
  return finite.length > 0 ? format.format(Math.max(...finite)) : "—";
}

/** Tooltip + accessible-name number format: the app locale, two decimals max. */
function makeNumberFormat(locale: Locale): Intl.NumberFormat {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
}

export function SeriesChart({
  series,
  metric: controlledMetric,
  onMetricChange,
  palette: paletteOverrides,
}: {
  series: FlightSeries;
  /** Controlled metric; with it the chart renders no toggles of its own. */
  metric?: MetricKey;
  onMetricChange?: (metric: MetricKey) => void;
  palette?: SeriesChartPalette;
}) {
  const t = useT();
  const { locale } = useLocale();
  const reduceMotion = useReducedMotion() === true;
  const format = useMemo(() => makeNumberFormat(locale), [locale]);
  const tokens = useChartTokens();
  const colors = useMemo(
    () => mergePalette(tokenPalette(tokens), paletteOverrides),
    [tokens, paletteOverrides],
  );

  const available = METRICS.filter(
    (m) => Array.isArray(series[m.key]) && (series[m.key] as number[]).length > 0,
  );
  const [internalActive, setInternalActive] = useState<MetricKey>(available[0]?.key ?? "altitude");
  const controlled = controlledMetric !== undefined;
  const active = controlled ? controlledMetric : internalActive;
  const setActive = (next: MetricKey) => {
    if (!controlled) setInternalActive(next);
    onMetricChange?.(next);
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current, null, { renderer: "canvas" });
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const metric = METRICS.find((m) => m.key === active);
    if (!chartRef.current || !metric) return;
    chartRef.current.setOption(buildOption(series, metric, { t, format, reduceMotion, colors }), true);
  }, [active, series, t, format, reduceMotion, colors]);

  if (available.length === 0) return null;

  const activeMetric = METRICS.find((m) => m.key === active) ?? available[0];
  const chartName = t("chart.ariaLabel", {
    metric: t(activeMetric.labelKey),
    max: formatPeak((series[activeMetric.key] ?? []) as number[], format),
  });

  return (
    <div className="flex flex-col gap-4">
      {!controlled && (
        <div className="flex flex-wrap gap-2">
          {available.map((m) => (
            <button
              key={m.key}
              type="button"
              aria-pressed={active === m.key}
              onClick={() => setActive(m.key)}
              className={cn(
                "h-8 rounded-full border px-3.5 text-[13px] font-medium transition-[background-color,border-color,color] duration-300 ease-[var(--ease-spring)] pointer-coarse:min-h-11",
                focusRing,
                active === m.key
                  ? // Selection is graphite, like every control: red is brand or error.
                    "border-primary bg-primary text-on-primary"
                  : "border-transparent bg-chip text-ink-2 hover:bg-accent-soft hover:text-ink",
            )}
          >
            {t(m.labelKey)}
          </button>
        ))}
      </div>
      )}
      <div ref={containerRef} role="img" aria-label={chartName} className="h-[360px] w-full" />
    </div>
  );
}
