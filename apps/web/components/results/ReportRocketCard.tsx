"use client";

/**
 * ReportRocketCard — the rocket half of the report's Configuration (S7):
 * the compact RocketSummaryCard of the run's export, from the same export
 * detail the OpenRocket row reads (react-query dedupes the fetch). Nothing
 * renders while it loads or when the run predates the export link.
 */

import { useMemo } from "react";
import { useExportDetailQuery, useRunSummaryQuery } from "@/lib/queries";
import { rocketSummaryFromManifest } from "@/lib/domain/rocket";
import { RocketSummaryCard } from "@/components/workbench/RocketSummaryCard";

export function ReportRocketCard({ runId }: { runId: string }) {
  const run = useRunSummaryQuery(runId).data;
  const exportId = run?.export_id ?? "";
  const detail = useExportDetailQuery(exportId, { enabled: exportId !== "" });
  const manifest = detail.data?.manifest;
  const summary = useMemo(() => (manifest ? rocketSummaryFromManifest(manifest) : null), [manifest]);
  if (!summary) return null;

  return <RocketSummaryCard summary={summary} name={run?.name} file={run?.ork_filename} compact />;
}
