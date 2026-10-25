"use client";

/**
 * ResultsActions — "Simulate again" / "New rocket" on the run report (S9).
 * A client island: both drive the client-side WizardProvider (goto/reset are
 * nav-only — see WizardProvider.tsx's issue #50 context split) before
 * navigating back to the Workbench.
 *
 * "Simulate again" is a real link (Cmd/Ctrl-click, middle-click and
 * "open in new tab" keep working) that moves the draft to the basics step
 * on the way out. "New rocket" stays a button: it discards the draft before
 * navigating, which is a mutation, not a navigation — and because it is
 * destructive it asks first instead of resetting on the spot.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizardNav } from "@/components/wizard/WizardProvider";
import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { ghostButton, primaryButton } from "@/components/workbench/styles";

export function ResultsActions() {
  const t = useT();
  const router = useRouter();
  const { goto, reset } = useWizardNav();
  const [confirming, setConfirming] = useState(false);

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
        <button type="button" onClick={newRocket} className={cn(primaryButton, "bg-bad")}>
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
      <Link href="/" onClick={() => goto("basics")} className={ghostButton}>
        {t("results.simulateAgain")}
      </Link>
      <button type="button" onClick={() => setConfirming(true)} className={ghostButton}>
        {t("results.newRocket")}
      </button>
    </div>
  );
}
