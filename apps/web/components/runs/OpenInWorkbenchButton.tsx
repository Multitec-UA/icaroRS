"use client";

/**
 * Row actions of the runs table, icon-only with a tooltip and a clear
 * hierarchy (Carbon, NN/g: one primary action per row, the others quieter,
 * always in the same place):
 *
 * - ViewReportButton (primary, eye): the run's report at `/results/{id}`.
 * - OpenInWorkbenchButton (secondary, play): a plain link to `/?run={id}`
 *   (S8). The Workbench resolves that URL into the run's file, scenario and
 *   result and shows it "Up to date"; nothing is simulated on the way. A
 *   failed run has no result to open, and a run written before the
 *   Rocket/Export split has no file — the control is then a disabled button
 *   whose tooltip and accessible name say why.
 *
 * Each control's accessible name is its `aria-label`; the tooltip shows the
 * same words and is decorative.
 */

import Link from "next/link";
import type { SimulationSummary } from "@/lib/api";
import { Tooltip, buttonClass } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { EyeIcon, PlayIcon } from "@/components/workbench/icons";

const PRIMARY_CLASS = buttonClass({ variant: "primary", size: "icon" });
const SECONDARY_CLASS = buttonClass({ variant: "ghost", size: "icon" });

/** The Workbench URL that shows a dispersion run with its file (S12). */
export function workbenchMonteCarloHref(exportId: string, runId: string): string {
  return `/?file=${encodeURIComponent(exportId)}&mc=${encodeURIComponent(runId)}`;
}

/** The Workbench URL that shows one run (S8). */
export function workbenchRunHref(runId: string): string {
  return `/?run=${encodeURIComponent(runId)}`;
}

export function ViewReportButton({ runId }: { runId: string }) {
  const t = useT();
  const label = t("runs.viewReport");
  return (
    <Tooltip label={label}>
      <Link href={`/results/${encodeURIComponent(runId)}`} aria-label={label} className={PRIMARY_CLASS}>
        <EyeIcon />
      </Link>
    </Tooltip>
  );
}

export function OpenInWorkbenchButton({ run }: { run: SimulationSummary }) {
  const t = useT();
  const label = t("runs.openInWorkbench");
  const unavailable = run.status === "error" || !run.export_id;

  if (unavailable) {
    const reason = !run.export_id ? t("runs.openNoExport") : t("runs.openUnavailable");
    return (
      // The tooltip sits on a wrapper: a disabled button gets no pointer events.
      <Tooltip label={reason} align="end">
        <button type="button" disabled aria-label={`${label}. ${reason}`} className={SECONDARY_CLASS}>
          <PlayIcon />
        </button>
      </Tooltip>
    );
  }

  return (
    <Tooltip label={label} align="end">
      <Link href={workbenchRunHref(run.simulation_id)} aria-label={label} className={SECONDARY_CLASS}>
        <PlayIcon />
      </Link>
    </Tooltip>
  );
}
