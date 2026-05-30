"use client";

/**
 * SeriesChart — interactive 2D flight chart (issue #11).
 *
 * One metric at a time (altitude / speed / Mach / acceleration) vs time, with
 * hover tooltip, zoom + pan (mouse wheel and a slider). ECharts, themed to the
 * dark "Ethereal Glass" look. Client-only; meant to be dynamically imported
 * (ssr:false) so echarts never runs during SSR and stays code-split.
 */

import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import type { FlightSeries } from "@/lib/api";
import { cn } from "@/components/ui";

type MetricKey = "altitude" | "speed" | "mach" | "acceleration";

const METRICS: { key: MetricKey; label: string; unit: string; color: string }[] = [
  { key: "altitude", label: "Altitude", unit: "m", color: "#22d3ee" },
  { key: "speed", label: "Speed", unit: "m/s", color: "#a78bfa" },
  { key: "mach", label: "Mach", unit: "", color: "#34d399" },
  { key: "acceleration", label: "Acceleration", unit: "m/s²", color: "#f472b6" },
];

function buildOption(
  series: FlightSeries,
  metric: (typeof METRICS)[number],
): echarts.EChartsCoreOption {
  const ys = (series[metric.key] ?? []) as number[];
  const data = series.t.map((t, i) => [t, ys[i]]);
  const axisColor = "rgba(255,255,255,0.15)";
  const splitColor = "rgba(255,255,255,0.05)";
  const muted = "#8b8f9c";

  return {
    backgroundColor: "transparent",
    grid: { left: 60, right: 24, top: 24, bottom: 72 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(11,11,14,0.95)",
      borderColor: "rgba(255,255,255,0.12)",
      borderWidth: 1,
      textStyle: { color: "#ededf2", fontSize: 12 },
      axisPointer: { lineStyle: { color: "rgba(255,255,255,0.25)" } },
      formatter: (params: unknown) => {
        const p = (params as { value: [number, number] }[])[0];
        const u = metric.unit ? ` ${metric.unit}` : "";
        return `t = ${p.value[0].toFixed(2)} s<br/><b>${metric.label}: ${p.value[1].toFixed(2)}${u}</b>`;
      },
    },
    xAxis: {
      type: "value",
      name: "Time (s)",
      nameLocation: "middle",
      nameGap: 34,
      nameTextStyle: { color: muted },
      axisLine: { lineStyle: { color: axisColor } },
      axisLabel: { color: muted },
      splitLine: { lineStyle: { color: splitColor } },
    },
    yAxis: {
      type: "value",
      name: metric.unit ? `${metric.label} (${metric.unit})` : metric.label,
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
        backgroundColor: "rgba(255,255,255,0.04)",
        fillerColor: "rgba(34,211,238,0.12)",
        handleStyle: { color: metric.color, borderColor: metric.color },
        moveHandleStyle: { color: metric.color },
        dataBackground: { lineStyle: { color: muted }, areaStyle: { color: "rgba(255,255,255,0.04)" } },
        textStyle: { color: muted },
      },
    ],
    series: [
      {
        type: "line",
        smooth: true,
        showSymbol: false,
        data,
        lineStyle: { color: metric.color, width: 2 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: `${metric.color}55` },
            { offset: 1, color: `${metric.color}00` },
          ]),
        },
      },
    ],
    animationDuration: 600,
    animationEasing: "cubicOut",
  };
}

export function SeriesChart({ series }: { series: FlightSeries }) {
  const available = METRICS.filter(
    (m) => Array.isArray(series[m.key]) && (series[m.key] as number[]).length > 0,
  );
  const [active, setActive] = useState<MetricKey>(available[0]?.key ?? "altitude");
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
    chartRef.current.setOption(buildOption(series, metric), true);
  }, [active, series]);

  if (available.length === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        {available.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setActive(m.key)}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium ring-1 ring-inset transition-all duration-500 ease-[var(--ease-spring)]",
              active === m.key
                ? "text-foreground ring-white/25"
                : "text-muted ring-white/10 hover:text-foreground hover:ring-white/20",
            )}
            style={
              active === m.key
                ? { boxShadow: `0 0 24px -10px ${m.color}`, background: `${m.color}1a` }
                : undefined
            }
          >
            {m.label}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="h-[360px] w-full" />
    </div>
  );
}
