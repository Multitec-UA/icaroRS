"use client";

/**
 * ReportRocketCard — the rocket half of the report's Configuration (S7):
 * the compact RocketSummaryCard of the run's export, from the same export
 * detail the OpenRocket row reads (react-query dedupes the fetch). Nothing
 * renders while it loads or when the run predates the export link. When the
 * export request fails (S12i) the slot says "File no longer available"; the
 * rest of the report renders from the run itself.
 */

import { useMemo } from "react";
import { rocketSummaryFromManifest } from "@/lib/domain/rocket";
import { RocketSummaryCard } from "@/components/workbench/RocketSummaryCard";
import { useT } from "@/components/i18n/LocaleProvider";
import { useReportExport } from "./useReportExport";
import { fileLabel } from "@/lib/domain/exports";

export function ReportRocketCard({ runId }: { runId: string }) {
  const t = useT();
  const { run, detail, gone } = useReportExport(runId);
  const manifest = detail.data?.manifest;
  const summary = useMemo(() => (manifest ? rocketSummaryFromManifest(manifest) : null), [manifest]);
  if (gone) {
    return (
      <p className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-muted">
        {t("report.fileGone")}
      </p>
    );
  }
  if (!summary) return null;

  return <RocketSummaryCard summary={summary} name={run?.name} file={run?.ork_filename ? fileLabel(run.ork_filename, run.ork_revision) : run?.ork_filename} compact />;
}
