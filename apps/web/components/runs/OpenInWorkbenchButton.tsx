"use client";

/**
 * OpenInWorkbenchButton — "Open in Workbench" for one run of the table (S8):
 * a plain link to `/?run={id}`. The Workbench resolves that URL into the
 * run's file, scenario and result and shows it "Up to date"; nothing is
 * simulated on the way (the old "Re-run" started a silent new run). A failed
 * run has no result to open, and a run written before the Rocket/Export
 * split has no file — the control is then a disabled button that says why.
 * The visible label is the short "Workbench" so the table stays narrow; the
 * accessible name keeps the full "Open in Workbench".
 */

import Link from "next/link";
import type { SimulationSummary } from "@/lib/api";
import { textLink } from "@/components/ui/classes";
import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { PlayIcon } from "@/components/workbench/icons";

/**
 * One style for every row action of the runs table (Carbon, NN/g: row
 * actions are consistent and quiet, in the same place on every row).
 */
export const rowActionClass = cn(textLink, "inline-flex items-center gap-1 whitespace-nowrap");
const DISABLED_CLASS = cn(rowActionClass, "cursor-not-allowed text-muted no-underline hover:text-muted");

/** The Workbench URL that shows one run (S8). */
export function workbenchRunHref(runId: string): string {
  return `/?run=${encodeURIComponent(runId)}`;
}

export function OpenInWorkbenchButton({ run }: { run: SimulationSummary }) {
  const t = useT();
  const unavailable = run.status === "error" || !run.export_id;

  if (unavailable) {
    const reason = !run.export_id ? t("runs.openNoExport") : t("runs.openUnavailable");
    return (
      <button type="button" disabled title={reason} className={DISABLED_CLASS}>
        <PlayIcon className="h-3.5 w-3.5" />
        <span aria-hidden>{t("runs.openInWorkbenchShort")}</span>
        <span className="sr-only">{t("runs.openInWorkbench")}</span>
        {/* A disabled button gives no reason on its own; say it for assistive tech. */}
        <span className="sr-only">{reason}</span>
      </button>
    );
  }

  return (
    <Link
      href={workbenchRunHref(run.simulation_id)}
      aria-label={t("runs.openInWorkbench")}
      title={t("runs.openInWorkbench")}
      className={rowActionClass}
    >
      <PlayIcon className="h-3.5 w-3.5" />
      {t("runs.openInWorkbenchShort")}
    </Link>
  );
}
