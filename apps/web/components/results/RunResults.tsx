"use client";

/**
 * RunResults (S7) — the one composition of a run's results, rendered by the
 * Workbench's results column and by the run report alike:
 *
 *   Warnings → FlightReplay (skeleton while the series loads, a note when the
 *   run has none) → KPI cards → the OpenRocket comparison row (only when the
 *   file stores OpenRocket's own results) → Series panel → Flight timeline →
 *   "All results (16 values)" → "Plots (12)".
 *
 * The caller owns the data: the result envelope, the series query (so the
 * Workbench and the report keep their own fetch) and the summary of the
 * export the run simulated. The plot PNGs mount only once "Plots" is opened,
 * and both disclosures open before printing; in print the replay gives way
 * to the `trajectory_3d` PNG (see the print rules in app/globals.css).
 *
 * Must sit under a <ReplayProvider>: the replay, the KPIs and the timeline
 * share its clock.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { ApiError, type FlightSeries, type SimulateResult } from "@/lib/api";
import type { RocketSummary } from "@/lib/domain/rocket";
import { SCALAR_SPECS, formatScalarIn } from "@/lib/scalars";
import { plural } from "@/lib/i18n";
import { Callout, Disclosure } from "@/components/ui";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import { FlightReplay } from "@/components/flight/FlightReplay";
import { FlightSkeleton } from "@/components/flight/FlightSkeleton";
import { FlightTimeline } from "@/components/flight/FlightTimeline";
import { KpiCards } from "@/components/flight/KpiCards";
import { PlotGallery } from "@/components/flight/PlotGallery";
import { SeriesPanel } from "@/components/flight/SeriesPanel";
import { WarningsBanner } from "@/components/flight/WarningsBanner";
import { formatMeasureQuantity } from "@/components/flight/flightMath";

export type RunResultData = Pick<SimulateResult, "scalars" | "warnings" | "plot_urls">;

export interface RunResultsProps {
  runId: string;
  result: RunResultData;
  /** What the run's export says about the rocket; null when unknown (no stored-results row). */
  exportSummary: RocketSummary | null;
  /** The run's series query (useSeriesQuery); a 404 is the normal "no series". */
  series: Pick<UseQueryResult<FlightSeries>, "data" | "error" | "isError" | "isPending">;
}

export function RunResults({ runId, result, exportSummary, series }: RunResultsProps) {
  const t = useT();
  const rootRef = useRef<HTMLDivElement>(null);
  const [plotsOpen, setPlotsOpen] = useState(false);
  // Set on `beforeprint`: only then does the print-only trajectory PNG mount
  // (a hidden lazy <img> would never load on screen, and never settle).
  const [printing, setPrinting] = useState(false);

  const data = series.data;
  const hasPath = Array.isArray(data?.path3d) && data.path3d.length >= 2;
  const notFound = series.isError && series.error instanceof ApiError && series.error.status === 404;
  const failed = series.isError && !notFound;
  const message = series.error instanceof Error ? series.error.message : null;
  const trajectoryPng = result.plot_urls.find((url) => /\/trajectory_3d\.png$/.test(url)) ?? null;

  // Printing shows everything: open both disclosures (and mount the plots).
  useEffect(() => {
    function onBeforePrint() {
      setPlotsOpen(true);
      setPrinting(true);
      rootRef.current?.querySelectorAll("details").forEach((details) => {
        details.open = true;
      });
    }
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);

  return (
    <div ref={rootRef} data-run-results={runId} className="flex flex-col gap-4">
      <WarningsBanner warnings={result.warnings} />

      <div className="print:hidden">
        {series.isPending && <FlightSkeleton kind="replay" />}
        {data && hasPath && <FlightReplay series={data} scalars={result.scalars} />}
        {(notFound || (data && !hasPath)) && (
          <p className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-ink-2">
            {t("flight.noSeries")}
          </p>
        )}
        {failed && <Callout tone="error">{message}</Callout>}
      </div>
      {printing && trajectoryPng && (
        // Print only: the WebGL replay does not print, its PNG does.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={trajectoryPng}
          alt={t("plots.trajectory_3d")}
          width={1200}
          height={900}
          className="palette-light hidden h-auto w-full rounded-[14px] border border-border print:block"
        />
      )}

      <KpiCards scalars={result.scalars} series={data ?? null} />
      {exportSummary?.storedResults && <OpenRocketRow stored={exportSummary.storedResults} />}

      {series.isPending && <FlightSkeleton kind="chart" />}
      {data && <SeriesPanel series={data} />}
      <FlightTimeline scalars={result.scalars} />

      <ScalarDisclosure scalars={result.scalars} />

      {result.plot_urls.length > 0 && (
        <Disclosure
          title={t("flight.plotsTitle")}
          count={result.plot_urls.length}
          meta={<PhoneHidden>{t("flight.plotsMeta")}</PhoneHidden>}
          onToggle={(open) => open && setPlotsOpen(true)}
        >
          {/* Mounted on first open and kept, so closing never refetches. */}
          {plotsOpen && (
            <div className="pt-3">
              <PlotGallery urls={result.plot_urls} bare />
            </div>
          )}
        </Disclosure>
      )}
    </div>
  );
}

/**
 * OpenRocket's own simulation, saved in the file under its own conditions.
 * One row, never per KPI card and never as a percentage off: the two
 * simulations do not share their inputs. Newer manifests label it with the
 * simulation's name ("OpenRocket · Simulation 1") and an "outdated" mark
 * when OpenRocket says so; old ones keep the generic label.
 */
function OpenRocketRow({ stored }: { stored: NonNullable<RocketSummary["storedResults"]> }) {
  const t = useT();
  const { locale } = useLocale();
  const { system } = useUnits();
  const q = (value: number, kind: "length" | "speed" | "time") => formatMeasureQuantity(value, kind, system, locale);
  const parts = [
    stored.apogeeM !== null && t("flight.openRocketApogee", { value: q(stored.apogeeM, "length") }),
    stored.maxVelocityMs !== null && t("flight.openRocketMaxSpeed", { value: q(stored.maxVelocityMs, "speed") }),
    stored.flightTimeS !== null && t("flight.openRocketFlightTime", { value: q(stored.flightTimeS, "time") }),
  ].filter((part): part is string => typeof part === "string");
  const outdated = stored.status === "outdated";

  return (
    <p
      data-testid="openrocket-row"
      className="rounded-xl border border-dashed border-axis px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2"
    >
      <span className="font-semibold text-ink">
        {stored.simulationName === null && !outdated ? (
          t("flight.openRocketSource")
        ) : (
          <>
            {stored.simulationName === null
              ? t("flight.openRocketLabel")
              : t("flight.openRocketNamed", { name: stored.simulationName })}
            {outdated && (
              <>
                {" · "}
                <span className="text-warn-ink">{t("flight.openRocketOutdated")}</span>
              </>
            )}
            :
          </>
        )}
      </span>{" "}
      {parts.map((part, index) => (
        <span key={index} className="tabular-nums">
          {index > 0 && <span className="text-muted">{" · "}</span>}
          {part}
        </span>
      ))}
    </p>
  );
}

/** "All results (N values)": every scalar the core returned, with its catalog label. */
function ScalarDisclosure({ scalars }: { scalars: Record<string, number | null> }) {
  const t = useT();
  const { locale } = useLocale();
  const { system } = useUnits();
  const specs = SCALAR_SPECS.filter((spec) => spec.key in scalars);
  if (specs.length === 0) return null;
  const title = t("flight.allResultsTitle");

  return (
    <Disclosure
      title={
        <>
          {title}
          <span className="font-normal text-muted">{` (${plural(locale, specs.length, "flight.allResultsCount")})`}</span>
        </>
      }
      meta={<PhoneHidden>{t("flight.allResultsMeta")}</PhoneHidden>}
    >
      <section aria-label={title}>
        <dl className="flex flex-col text-sm">
          {specs.map((spec) => (
            <div
              key={spec.key}
              className="flex items-baseline justify-between gap-4 border-t border-divider py-2 first:border-t-0"
            >
              <dt className="text-ink-2">{t(`scalars.${spec.key}`)}</dt>
              <dd className="font-medium tabular-nums text-ink">{formatScalarIn(scalars[spec.key], spec, system, locale)}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Disclosure>
  );
}

/** A disclosure's meta line yields to its title on phones (S10): hidden below `sm`. */
function PhoneHidden({ children }: { children: ReactNode }) {
  return <span className="max-sm:hidden">{children}</span>;
}
