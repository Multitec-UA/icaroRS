"use client";

/**
 * RealFlightChart: one quantity over time, simulated vs real, in one SVG
 * (real-flight-compare S6). Pure SVG like the /runs OverlayChart: two lines
 * of a few hundred points cost no bundle and can be asserted on in tests.
 *
 * The simulated line is the Multitec red (chart series 1, `--accent`) and
 * solid; the real line is graphite (series 2, `--peach`) and dashed, so the
 * two tell apart without colour too. The legend sits above the plot as text;
 * the SVG carries an accessible name with both peaks. Values arrive in SI and
 * are drawn in the unit system in effect. Gaps (a side outside its own time
 * range) break the line instead of drawing a zero.
 */

import { useMemo } from "react";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import { formatNumber, formatQuantity } from "@/components/flight/flightMath";
import { linePath, peak, valueRange, type ChartData } from "@/lib/domain/realflight";
import type { MeasureKind } from "@/lib/units";

const W = 640;
const H = 200;
const PAD = { left: 52, right: 12, top: 10, bottom: 26 };

export function RealFlightChart({
  title,
  data,
  kind,
}: {
  title: string;
  data: ChartData;
  kind: MeasureKind;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { display, label } = useUnits();
  const unit = label(kind);

  const drawn = useMemo(() => {
    const conv = (values: (number | null)[]) => values.map((v) => (v === null ? null : display(v, kind)));
    const shown: ChartData = { t: data.t, sim: conv(data.sim), real: conv(data.real) };
    const range = valueRange(shown);
    const t0 = data.t[0] ?? 0;
    const t1 = data.t[data.t.length - 1] ?? 1;
    if (!range || !(t1 > t0)) return null;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const sx = (time: number) => PAD.left + ((time - t0) / (t1 - t0)) * innerW;
    const sy = (v: number) => PAD.top + innerH - ((v - range.min) / (range.max - range.min)) * innerH;
    return {
      t0,
      t1,
      range,
      sy,
      zeroY: range.min < 0 && range.max > 0 ? sy(0) : null,
      simPath: linePath(shown.t, shown.sim, sx, sy),
      realPath: linePath(shown.t, shown.real, sx, sy),
      simPeak: peak(shown.sim),
      realPeak: peak(shown.real),
    };
  }, [data, display, kind]);

  if (!drawn) return null;

  const fmt = (v: number | null) => (v === null ? "–" : formatQuantity(v, unit, locale));
  const ariaLabel = t("realflight.chartAria", {
    quantity: title,
    sim: fmt(drawn.simPeak),
    real: fmt(drawn.realPeak),
  });
  const bottom = H - PAD.bottom;

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-sm font-semibold text-ink">
          {title}
          <span className="font-normal text-muted">{unit ? ` (${unit})` : ""}</span>
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2">
          <svg aria-hidden="true" width="22" height="8" className="overflow-visible">
            <line x1="0" y1="4" x2="22" y2="4" className="stroke-accent" strokeWidth={2.5} strokeLinecap="round" />
          </svg>
          {t("realflight.legendSim")}
        </span>
        <span className="flex items-center gap-1.5 text-xs text-ink-2">
          <svg aria-hidden="true" width="22" height="8" className="overflow-visible">
            <line x1="0" y1="4" x2="22" y2="4" className="stroke-peach" strokeWidth={2.5} strokeDasharray="5 3" />
          </svg>
          {t("realflight.legendReal")}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="block h-auto w-full">
        <g className="stroke-divider" strokeWidth={1}>
          {[0.25, 0.5, 0.75].map((f) => {
            const y = PAD.top + (bottom - PAD.top) * f;
            return <line key={f} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} />;
          })}
        </g>
        <line x1={PAD.left} y1={bottom} x2={W - PAD.right} y2={bottom} className="stroke-axis" strokeWidth={1} />
        {drawn.zeroY !== null && (
          <line
            data-zero-line=""
            x1={PAD.left}
            y1={drawn.zeroY}
            x2={W - PAD.right}
            y2={drawn.zeroY}
            className="stroke-axis"
            strokeWidth={1}
          />
        )}
        <g className="fill-muted tabular-nums" fontSize={10}>
          <text x={PAD.left - 8} y={PAD.top + 3} textAnchor="end">
            {formatNumber(drawn.range.max, locale)}
          </text>
          {drawn.zeroY !== null && (
            <text x={PAD.left - 8} y={drawn.zeroY + 3} textAnchor="end">
              0
            </text>
          )}
          <text x={PAD.left - 8} y={bottom + 3} textAnchor="end">
            {formatNumber(drawn.range.min, locale)}
          </text>
          <text x={PAD.left} y={H - 8}>
            {formatQuantity(drawn.t0, "s", locale)}
          </text>
          <text x={W - PAD.right} y={H - 8} textAnchor="end">
            {formatQuantity(drawn.t1, "s", locale)}
          </text>
        </g>
        <path
          data-side="real"
          d={drawn.realPath}
          fill="none"
          className="stroke-peach"
          strokeWidth={2}
          strokeDasharray="6 4"
          strokeLinejoin="round"
        />
        <path
          data-side="sim"
          d={drawn.simPath}
          fill="none"
          className="stroke-accent"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </figure>
  );
}
