"use client";

/**
 * KpiCards — the four headline numbers of a run (S9): Apogee, Max speed,
 * Stability off rail and Landing (distance from the pad, √(x² + y²)). Each
 * card counts its number up (CountUp), carries a one-line caption from the
 * related scalar and, when the series is there, a small sparkline that
 * draws itself in on mount. Missing scalars render "—", never NaN.
 */

import { useEffect, useMemo, useRef } from "react";
import { useReducedMotion } from "motion/react";
import type { FlightSeries } from "@/lib/api";
import { CountUp, Reveal } from "@/components/motion";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import {
  formatNumber,
  formatQuantity,
  formatSeconds,
  groundTrack,
  isFiniteNumber,
  landingDistance,
  splitDistance,
} from "./flightMath";

const SPARK_W = 120;
const SPARK_H = 24;
const SPARK_PAD = 1.5;
const SPARK_MAX_POINTS = 120;

/** Normalised polyline for the sparkline; null with fewer than two finite points. */
function sparklinePath(values: number[]): string | null {
  const finite = values.filter(isFiniteNumber);
  if (finite.length < 2) return null;
  // Long series are thinned to one point per device-ish pixel.
  const stride = Math.max(1, Math.ceil(finite.length / SPARK_MAX_POINTS));
  const pts = finite.filter((_, i) => i % stride === 0 || i === finite.length - 1);
  let min = Infinity;
  let max = -Infinity;
  for (const v of pts) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const span = max - min || 1;
  const innerW = SPARK_W - SPARK_PAD * 2;
  const innerH = SPARK_H - SPARK_PAD * 2;
  return pts
    .map((v, i) => {
      const x = SPARK_PAD + (i / (pts.length - 1)) * innerW;
      const y = SPARK_PAD + innerH - ((v - min) / span) * innerH;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

// Same curve as `--ease-out-soft`; the Web Animations API cannot read CSS variables.
const DRAW_EASING = "cubic-bezier(0.16, 1, 0.3, 1)";
const DRAW_MS = 1400;

function Sparkline({ values, strokeClass }: { values: number[]; strokeClass: string }) {
  const reduce = useReducedMotion() === true;
  const d = useMemo(() => sparklinePath(values), [values]);
  const pathRef = useRef<SVGPathElement>(null);

  // Draw-in on mount: `pathLength=100` normalises the dash so the offset
  // runs 100 → 0 whatever the path's real length. Reduced motion renders the
  // line complete; without the Web Animations API (jsdom) it is shown at once.
  useEffect(() => {
    const el = pathRef.current;
    if (!el || reduce) return;
    if (typeof el.animate !== "function") {
      el.style.strokeDashoffset = "0";
      return;
    }
    const animation = el.animate([{ strokeDashoffset: 100 }, { strokeDashoffset: 0 }], {
      duration: DRAW_MS,
      easing: DRAW_EASING,
      fill: "forwards",
    });
    return () => animation.cancel();
  }, [reduce, d]);

  if (!d) return null;
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} aria-hidden className="mt-1.5 block h-6 w-full">
      <path
        ref={pathRef}
        data-sparkline
        d={d}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={100}
        className={strokeClass}
        style={{ strokeDasharray: 100, strokeDashoffset: reduce ? 0 : 100 }}
      />
    </svg>
  );
}

interface KpiCard {
  key: string;
  title: string;
  value: { amount: number; unit: string } | null;
  caption: string | null;
  spark: number[] | null;
  strokeClass: string;
}

export function KpiCards({
  scalars,
  series,
}: {
  scalars: Record<string, number | null>;
  series?: FlightSeries | null;
}) {
  const t = useT();
  const { locale } = useLocale();

  const num = (key: string): number | null => {
    const v = scalars[key];
    return isFiniteNumber(v) ? v : null;
  };
  const quantity = (key: string, unit: string) => {
    const v = num(key);
    return v === null ? null : { amount: v, unit };
  };

  const apogeeTime = num("apogee_time_s");
  const maxMach = num("max_mach");
  const railSpeed = num("rail_departure_velocity_ms");
  const impactSpeed = num("impact_velocity_ms");
  const distance = landingDistance(num("impact_x_m"), num("impact_y_m"));

  const cards: KpiCard[] = [
    {
      key: "apogee",
      title: t("flight.kpiApogee"),
      value: quantity("apogee_m", "m"),
      caption: apogeeTime === null ? null : t("flight.kpiAtTime", { time: formatSeconds(apogeeTime, locale) }),
      spark: series?.altitude ?? null,
      strokeClass: "stroke-accent",
    },
    {
      key: "maxSpeed",
      title: t("flight.kpiMaxSpeed"),
      value: quantity("max_velocity_ms", "m/s"),
      caption: maxMach === null ? null : t("flight.kpiMach", { mach: formatNumber(maxMach, locale, 2) }),
      spark: series?.speed ?? null,
      strokeClass: "stroke-peach",
    },
    {
      key: "stability",
      title: t("flight.kpiStability"),
      value: quantity("rail_departure_stability_margin", "cal"),
      caption:
        railSpeed === null ? null : t("flight.kpiOffRail", { speed: formatQuantity(railSpeed, "m/s", locale) }),
      spark: series?.mach ?? series?.acceleration ?? null,
      strokeClass: "stroke-ok",
    },
    {
      key: "landing",
      title: t("flight.kpiLanding"),
      value: distance === null ? null : splitDistance(distance),
      caption:
        impactSpeed === null ? null : t("flight.kpiImpact", { speed: formatQuantity(impactSpeed, "m/s", locale) }),
      spark: series?.path3d ? groundTrack(series.path3d) : null,
      strokeClass: "stroke-accent",
    },
  ];

  return (
    <section aria-label={t("flight.kpiRegion")} className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map((card, i) => (
        <Reveal key={card.key} delay={0.14 + i * 0.05} className="min-w-0">
          <div
            role="group"
            aria-label={card.title}
            className="flex h-full flex-col rounded-2xl border border-border bg-surface p-4 shadow-soft"
          >
            <div className="text-[13px] text-muted">{card.title}</div>
            <div className="mt-1.5 text-[28px] font-semibold leading-none tracking-[-0.02em] text-ink">
              {card.value ? (
                <>
                  <CountUp
                    value={card.value.amount}
                    format={(n) => formatNumber(n, locale)}
                    className="tabular-readout"
                  />
                  <span className="text-sm font-medium text-muted">{` ${card.value.unit}`}</span>
                </>
              ) : (
                <span className="tabular-readout">—</span>
              )}
            </div>
            <div className="mt-2 min-h-4 text-xs text-muted">{card.caption}</div>
            {card.spark && <Sparkline values={card.spark} strokeClass={card.strokeClass} />}
          </div>
        </Reveal>
      ))}
    </section>
  );
}
