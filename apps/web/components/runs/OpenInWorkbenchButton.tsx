"use client";

/**
 * OpenInWorkbenchButton — "Open in Workbench" for one run of the table (S8):
 * a plain link to `/?run={id}`. The Workbench resolves that URL into the
 * run's file, scenario and result and shows it "Up to date"; nothing is
 * simulated on the way (the old "Re-run" started a silent new run). A failed
 * run has no result to open, and a run written before the Rocket/Export
 * split has no file — the control is then a disabled button that says why.
 */

import Link from "next/link";
import type { SimulationSummary } from "@/lib/api";
import { buttonClass } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { PlayIcon } from "@/components/workbench/icons";

const CLASS = buttonClass({ variant: "ghost", size: "sm", className: "px-2.5" });

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
      <button type="button" disabled title={reason} className={CLASS}>
        <PlayIcon />
        {t("runs.openInWorkbench")}
        {/* A disabled button gives no reason on its own; say it for assistive tech. */}
        <span className="sr-only">{reason}</span>
      </button>
    );
  }

  return (
    <Link href={workbenchRunHref(run.simulation_id)} className={CLASS}>
      <PlayIcon />
      {t("runs.openInWorkbench")}
    </Link>
  );
}
