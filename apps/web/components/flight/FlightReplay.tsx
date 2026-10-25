"use client";

/**
 * FlightReplay — the Workbench's 3D flight card (S9, board A).
 *
 * The existing Trajectory3D scene in controlled mode, driven by
 * useReplayEngine: a marker travels the trajectory as simulated time
 * advances, with play/pause, a time scrubber, a 1×/4× speed toggle and a
 * live Alt / v / t readout. The camera orbits on its own only while
 * playing (Trajectory3D's behaviour, kept). Under prefers-reduced-motion
 * the replay starts paused at the end of the flight — the still, complete
 * trajectory — and every control keeps working.
 *
 * Colours come from the theme tokens (useThemeTokens → palette), never
 * from literals, so the scene follows the pastel light / soft dark themes.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import type { FlightSeries } from "@/lib/api";
import { SegmentedControl, Spinner } from "@/components/ui";
import { cn, focusRing } from "@/lib/styles";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { PauseIcon, PlayIcon } from "@/components/workbench/icons";
import {
  formatNumber,
  formatQuantity,
  isFiniteNumber,
  landingDistance,
  sampleAt,
  splitDistance,
} from "./flightMath";
import { useRegisterReplay } from "./ReplayContext";
import { useReplayEngine, useReplayTime, type ReplayEngine, type ReplaySpeed } from "./useReplayEngine";
import { useThemeTokens } from "./useThemeTokens";

const CANVAS_CLASS = "h-[340px] w-full";

function SceneLoading() {
  const t = useT();
  return (
    <div role="status" aria-live="polite" className={cn(CANVAS_CLASS, "flex items-center justify-center text-muted")}>
      <Spinner decorative /> <span className="ml-2 text-sm">{t("interactive.loading3d")}</span>
    </div>
  );
}

// three.js never runs during SSR and stays code-split (same as /results).
const Trajectory3D = dynamic(
  () => import("@/components/charts/Trajectory3D").then((m) => m.Trajectory3D),
  { ssr: false, loading: SceneLoading },
);

// Only the HUD subscribes to the per-frame time; the Canvas never re-renders.
function ReplayHud({ engine, series }: { engine: ReplayEngine; series: FlightSeries }) {
  const t = useT();
  const { locale } = useLocale();
  const time = useReplayTime(engine);
  const { duration, playing, speed } = engine;

  const altitude = sampleAt(series.t, series.altitude, time);
  const speedNow = sampleAt(series.t, series.speed, time);
  const speedOptions = useMemo(
    () =>
      [
        { value: "1" as const, label: t("flight.speed1x") },
        { value: "4" as const, label: t("flight.speed4x") },
      ] as const,
    [t],
  );
  // The slider moves in tenths of a second; long flights step coarser so
  // the keyboard still crosses the flight in a reasonable number of presses.
  const step = duration > 300 ? 1 : 0.1;

  return (
    <>
      <div
        role="group"
        aria-label={t("flight.liveReadout")}
        className="pointer-events-none absolute right-4 top-3.5 flex flex-wrap justify-end gap-1.5"
      >
        <LivePill label={t("flight.liveAltitude")} value={altitude === null ? "—" : formatQuantity(altitude, "m", locale)} />
        <LivePill label={t("flight.liveSpeed")} value={speedNow === null ? "—" : formatQuantity(speedNow, "m/s", locale)} />
        <LivePill label={t("flight.liveTime")} value={formatQuantity(time, "s", locale)} />
      </div>

      <div className="flex flex-wrap items-center gap-3 px-4 pb-3.5 pt-2.5">
        <button
          type="button"
          onClick={engine.toggle}
          aria-label={playing ? t("interactive.pause") : t("interactive.play")}
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-on-primary transition-[transform,background-color] duration-300 ease-[var(--ease-spring)] hover:scale-105 active:scale-95",
            focusRing,
          )}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <label className="flex min-w-[8rem] flex-1 items-center gap-2.5">
          <span className="sr-only">{t("interactive.scrubTimeline")}</span>
          <input
            type="range"
            min={0}
            max={duration}
            step={step}
            value={time}
            onChange={(e) => engine.seek(parseFloat(e.target.value))}
            aria-valuetext={formatQuantity(time, "s", locale)}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-chip accent-primary"
          />
        </label>
        <span className="tabular-readout shrink-0 text-xs text-muted">
          {t("flight.timeReadout", {
            time: formatNumber(time, locale),
            total: formatNumber(duration, locale),
          })}
        </span>
        <SegmentedControl
          label={t("flight.speedLabel")}
          options={speedOptions}
          value={String(speed) as "1" | "4"}
          onChange={(value) => engine.setSpeed(Number(value) as ReplaySpeed)}
          className="text-xs"
        />
      </div>
    </>
  );
}

function LivePill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-surface px-2.5 py-1 text-xs text-ink-2 shadow-soft">
      {label} <strong className="tabular-readout font-semibold text-ink">{value}</strong>
    </span>
  );
}

export function FlightReplay({
  series,
  scalars,
}: {
  series: FlightSeries;
  /** Headline scalars; with them the opaque canvas gets a one-line text summary. */
  scalars?: Record<string, number | null>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const reduceMotion = useReducedMotion() === true;
  const engine = useReplayEngine(series.t, { startAtEnd: reduceMotion });
  useRegisterReplay(engine.seek);

  // What the canvas shows, in words, for assistive tech (the WebGL scene is
  // opaque to it): only when both numbers exist, never a half sentence.
  const apogee = scalars?.apogee_m;
  const distance = landingDistance(scalars?.impact_x_m, scalars?.impact_y_m);
  const summary =
    isFiniteNumber(apogee) && distance !== null
      ? t("flight.replaySummary", {
          apogee: formatQuantity(apogee, "m", locale),
          distance: (({ amount, unit }) => formatQuantity(amount, unit, locale))(splitDistance(distance)),
        })
      : null;

  const tokens = useThemeTokens(["surface-2", "divider", "axis", "accent", "peach"] as const);
  const palette = useMemo(
    () => ({
      background: tokens["surface-2"],
      grid: tokens.divider,
      section: tokens.axis,
      line: tokens.accent,
      marker: tokens.peach,
    }),
    [tokens],
  );

  const path = series.path3d as [number, number, number][] | null | undefined;
  if (!path || path.length < 2) return null;

  return (
    <section
      aria-label={t("flight.replayRegion")}
      className="relative overflow-hidden rounded-2xl border border-border bg-surface-2"
    >
      <div className="pointer-events-none absolute left-4 top-3.5 z-10 flex flex-col gap-0.5">
        <span className="text-sm font-semibold text-ink">{t("flight.replayTitle")}</span>
        <span className="text-xs text-muted">{t("interactive.trajectoryHint")}</span>
      </div>
      {summary && <p className="sr-only">{summary}</p>}
      <Trajectory3D
        path={path}
        advance={engine.advance}
        autoRotate={engine.playing}
        palette={palette}
        className={CANVAS_CLASS}
      />
      <ReplayHud engine={engine} series={series} />
    </section>
  );
}
