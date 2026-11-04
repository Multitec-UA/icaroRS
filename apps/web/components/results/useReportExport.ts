"use client";

/**
 * The run report's view of the run's export (S12i): the history row, the
 * export detail it links to (`GET /api/exports/{id}`, shared with the
 * OpenRocket row and the rocket card — react-query dedupes the fetch), and
 * whether that file is gone. `gone` is true only when the export request
 * failed (404 or any other error); a run that predates the export link has
 * no export to lose.
 */

import { useExportDetailQuery, useRunSummaryQuery } from "@/lib/queries";

export function useReportExport(runId: string) {
  const run = useRunSummaryQuery(runId).data ?? null;
  const exportId = run?.export_id ?? "";
  const detail = useExportDetailQuery(exportId, { enabled: exportId !== "" });
  return { run, detail, gone: exportId !== "" && detail.isError };
}
