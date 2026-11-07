"use client";

/**
 * ReportRunResults — the report's results (S7): the same RunResults
 * composition the Workbench renders, fed from the client. The series come
 * from useSeriesQuery; the OpenRocket row needs the manifest of the run's
 * export, which the results envelope does not carry, so the run's history
 * row (useRunSummaryQuery, shared with the header) gives the export id and
 * GET /api/exports/{id} (useExportDetailQuery) the manifest. Until both
 * arrive, or when either is missing, the row is simply absent. The "Real
 * flight" card (comparison with an MT1 flight) follows, as in the Workbench.
 */

import { useMemo } from "react";
import { useExportDetailQuery, useRunSummaryQuery, useSeriesQuery } from "@/lib/queries";
import { rocketSummaryFromManifest } from "@/lib/domain/rocket";
import { RealFlightCard } from "./RealFlightCard";
import { RunResults, type RunResultData } from "./RunResults";

export function ReportRunResults({ runId, result }: { runId: string; result: RunResultData }) {
  const series = useSeriesQuery(runId);
  const exportId = useRunSummaryQuery(runId).data?.export_id ?? "";
  const detail = useExportDetailQuery(exportId, { enabled: exportId !== "" });
  const manifest = detail.data?.manifest;
  const exportSummary = useMemo(() => (manifest ? rocketSummaryFromManifest(manifest) : null), [manifest]);

  return (
    <>
      <RunResults runId={runId} result={result} exportSummary={exportSummary} series={series} />
      <RealFlightCard runId={runId} />
    </>
  );
}
