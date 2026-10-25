"use client";

/**
 * ReportFlight — the report's hero (S9, board C): the flight replay from
 * the run's series and the four KPI cards with their sparklines. A client
 * island because the series are fetched here (useSeriesQuery): while they
 * load the replay is a skeleton; a 404 (a run from before the feature, or
 * one whose series were skipped) leaves a note and the static plots at the
 * bottom of the report stand in; the KPIs show either way.
 */

import { ApiError } from "@/lib/api";
import { useSeriesQuery } from "@/lib/queries";
import { Callout } from "@/components/ui";
import { FlightReplay } from "@/components/flight/FlightReplay";
import { FlightSkeleton } from "@/components/flight/FlightSkeleton";
import { KpiCards } from "@/components/flight/KpiCards";
import { useT } from "@/components/i18n/LocaleProvider";

export function ReportFlight({ runId, scalars }: { runId: string; scalars: Record<string, number | null> }) {
  const t = useT();
  const series = useSeriesQuery(runId);
  const data = series.data;
  const hasPath = Array.isArray(data?.path3d) && data.path3d.length >= 2;
  const notFound = series.isError && series.error instanceof ApiError && series.error.status === 404;
  const failed = series.isError && !notFound;
  const message = series.error instanceof Error ? series.error.message : null;

  return (
    <>
      {series.isPending && <FlightSkeleton kind="replay" />}
      {data && hasPath && <FlightReplay series={data} scalars={scalars} />}
      {(notFound || (data && !hasPath)) && (
        <p className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-ink-2">
          {t("flight.noSeries")}
        </p>
      )}
      {failed && <Callout tone="error">{message}</Callout>}
      <KpiCards scalars={scalars} series={data ?? null} />
    </>
  );
}
