"use client";

/**
 * ResultsActions — "Copy link" / "Open in Workbench" / "New rocket" on the
 * run report (S8).
 *
 * "Copy link · visible to members of {org}" (S12h) copies the report's URL
 * and says who can open it: the signed-in user's organization (the same
 * `identity.org_id` the account menu shows). When the run's file is gone
 * (S12i), "Open in Workbench" is a disabled button titled "File no longer
 * available"; the report itself still renders.
 *
 * "Open in Workbench" is a real link to `/?run={id}` (Cmd/Ctrl-click,
 * middle-click and "open in new tab" keep working): the Workbench resolves
 * that URL into the run's file, scenario and result, the same action as the
 * /runs rows. "New rocket" stays a button: it discards the draft before
 * navigating, which is a mutation, not a navigation — and because it is
 * destructive it asks first instead of resetting on the spot.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizardNav } from "@/components/wizard/WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { workbenchRunHref } from "@/components/runs/OpenInWorkbenchButton";
import { useT } from "@/components/i18n/LocaleProvider";
import { buttonClass, ghostButton } from "@/components/ui/classes";
import { useReportExport } from "./useReportExport";

export function ResultsActions({ runId }: { runId: string }) {
  const t = useT();
  const router = useRouter();
  const { reset } = useWizardNav();
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  const { identity } = useAuth();
  const { gone } = useReportExport(runId);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/results/${encodeURIComponent(runId)}`);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  function newRocket() {
    reset();
    router.push("/");
  }

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="status" className="w-full text-sm text-muted sm:w-auto">
          {t("results.newRocketConfirm")}
        </p>
        <button type="button" onClick={newRocket} className={buttonClass({ variant: "danger" })}>
          {t("common.confirm")}
        </button>
        <button type="button" onClick={() => setConfirming(false)} className={ghostButton}>
          {t("common.cancel")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void copyLink()} className={ghostButton}>
        {t("report.copyLink", { org: identity.org_id })}
      </button>
      <span aria-live="polite" className="text-xs text-muted">
        {copied ? t("report.linkCopied") : null}
      </span>
      {gone ? (
        <button type="button" disabled title={t("report.fileGone")} className={ghostButton}>
          {t("runs.openInWorkbench")}
        </button>
      ) : (
        <Link href={workbenchRunHref(runId)} className={ghostButton}>
          {t("runs.openInWorkbench")}
        </Link>
      )}
      <button type="button" onClick={() => setConfirming(true)} className={ghostButton}>
        {t("results.newRocket")}
      </button>
    </div>
  );
}
