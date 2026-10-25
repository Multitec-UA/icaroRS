"use client";

/**
 * OverlayChart — N altitude-over-time lines in one SVG (S9, the /runs
 * overlay). Pure SVG rather than ECharts: a few hundred points per line is
 * nothing, and an inline SVG costs no bundle, works server-side, and can be
 * asserted on in tests. Colours resolve through the theme tokens; each line
 * draws itself in on mount via the Web Animations API, or appears complete
 * under prefers-reduced-motion. The container carries an accessible name
 * listing the runs — the drawing itself is decorative.
 */

import { useEffect, useMemo, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { formatNumber, formatQuantity, isFiniteNumber } from "./flightMath";
import { useThemeTokens } from "./useThemeTokens";

export interface OverlayLine {
  id: string;
  /** Legend label — also read out in the chart's accessible name. */
  label: string;
  /** Theme token the stroke resolves through (`accent`, `peach`, `ok`). */
  color: "accent" | "peach" | "ok";
  t: number[];
  values: number[];
}

const W = 640;
const H = 220;
const PAD = { left: 48, right: 12, top: 12, bottom: 28 };
const MAX_POINTS = 300;
const DRAW_MS = 1200;
// Same curve as `--ease-out-soft`; the Web Animations API cannot read CSS variables.
const DRAW_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

interface Scaled {
  paths: { id: string; d: string }[];
  maxT: number;
  maxY: number;
}

function scale(lines: OverlayLine[]): Scaled {
  let maxT = 0;
  let maxY = 0;
  for (const line of lines) {
    for (let i = 0; i < Math.min(line.t.length, line.values.length); i++) {
      if (isFiniteNumber(line.t[i]) && line.t[i] > maxT) maxT = line.t[i];
      if (isFiniteNumber(line.values[i]) && line.values[i] > maxY) maxY = line.values[i];
    }
  }
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const sx = (t: number) => PAD.left + (maxT > 0 ? t / maxT : 0) * innerW;
  const sy = (v: number) => PAD.top + innerH - (maxY > 0 ? v / maxY : 0) * innerH;
  const paths = lines.map((line) => {
    const n = Math.min(line.t.length, line.values.length);
    const stride = Math.max(1, Math.ceil(n / MAX_POINTS));
    const parts: string[] = [];
    for (let i = 0; i < n; i += stride) {
      const t = line.t[i];
      const v = line.values[i];
      if (!isFiniteNumber(t) || !isFiniteNumber(v)) continue;
      parts.push(`${parts.length === 0 ? "M" : "L"}${sx(t).toFixed(1)},${sy(v).toFixed(1)}`);
    }
    const last = n - 1;
    if (last >= 0 && last % stride !== 0 && isFiniteNumber(line.t[last]) && isFiniteNumber(line.values[last])) {
      parts.push(`L${sx(line.t[last]).toFixed(1)},${sy(line.values[last]).toFixed(1)}`);
    }
    return { id: line.id, d: parts.join(" ") };
  });
  return { paths, maxT, maxY };
}

export function OverlayChart({ lines }: { lines: OverlayLine[] }) {
  const t = useT();
  const { locale } = useLocale();
  const reduce = useReducedMotion() === true;
  const tokens = useThemeTokens(["accent", "peach", "ok", "axis", "divider", "muted"] as const);
  const { paths, maxT, maxY } = useMemo(() => scale(lines), [lines]);
  const svgRef = useRef<SVGSVGElement>(null);

  // Draw-in on mount and whenever the set of lines changes: `pathLength=100`
  // normalises the dash so the offset runs 100 → 0 whatever the real length.
  // Reduced motion renders the lines complete; without the Web Animations
  // API (jsdom) they are shown at once.
  const signature = paths.map((p) => p.id).join("|");
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || reduce) return;
    const animations: Animation[] = [];
    svg.querySelectorAll<SVGPathElement>("path[data-run]").forEach((el) => {
      if (typeof el.animate !== "function") {
        el.style.strokeDashoffset = "0";
        return;
      }
      animations.push(
        el.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], {
          duration: DRAW_MS,
          easing: DRAW_EASING,
          fill: "forwards",
        }),
      );
    });
    return () => animations.forEach((animation) => animation.cancel());
  }, [reduce, signature]);

  if (lines.length === 0) {
    return <p className="py-10 text-center text-sm text-muted">{t("flight.loadingSeries")}</p>;
  }

  const innerBottom = H - PAD.bottom;
  const gridYs = [0.25, 0.5, 0.75].map((f) => PAD.top + (innerBottom - PAD.top) * (1 - f));
  const axis = tokens.axis ?? "currentColor";
  const grid = tokens.divider ?? "currentColor";
  const muted = tokens.muted ?? "currentColor";

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={t("runs.overlayLabel", { runs: lines.map((line) => line.label).join(", ") })}
      className="block h-auto w-full"
    >
      <g stroke={grid} strokeWidth={1}>
        {gridYs.map((y) => (
          <line key={y} x1={PAD.left} y1={y} x2={W - PAD.right} y2={y} />
        ))}
      </g>
      <line x1={PAD.left} y1={innerBottom} x2={W - PAD.right} y2={innerBottom} stroke={axis} strokeWidth={1} />
      <g fill={muted} fontSize={10} className="tabular-nums">
        <text x={PAD.left - 8} y={innerBottom + 3} textAnchor="end">
          0
        </text>
        <text x={PAD.left - 8} y={PAD.top + (innerBottom - PAD.top) / 2 + 3} textAnchor="end">
          {formatNumber(maxY / 2, locale)}
        </text>
        <text x={PAD.left - 8} y={PAD.top + 3} textAnchor="end">
          {formatNumber(maxY, locale)}
        </text>
        <text x={PAD.left} y={H - 8}>
          {formatQuantity(0, "s", locale)}
        </text>
        <text x={W - PAD.right} y={H - 8} textAnchor="end">
          {formatQuantity(maxT, "s", locale)}
        </text>
      </g>
      {paths.map((path, index) => (
        <path
          key={path.id}
          data-run={path.id}
          d={path.d}
          fill="none"
          stroke={tokens[lines[index].color] ?? "currentColor"}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          pathLength={100}
          style={{ strokeDasharray: 100, strokeDashoffset: reduce ? 0 : 100 }}
        />
      ))}
    </svg>
  );
}
