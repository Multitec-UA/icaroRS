"use client";

/**
 * ResultsActions — "Simulate again" / "New rocket" (issue #52). A client
 * island: both drive the client-side WizardProvider (goto/reset are
 * nav-only — see WizardProvider.tsx's issue #50 context split) before
 * navigating back to the wizard root.
 *
 * "Simulate again" is a real link (Cmd/Ctrl-click, middle-click and
 * "open in new tab" keep working) that moves the wizard to the basics step
 * on the way out. "New rocket" stays a button: it discards the draft before
 * navigating, which is a mutation, not a navigation — and because it is
 * destructive it asks first instead of resetting on the spot.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useWizardNav } from "@/components/wizard/WizardProvider";
import { Button, ButtonLink } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";

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
        <Button variant="danger" onClick={newRocket}>
          {t("common.confirm")}
        </Button>
        <Button variant="ghost" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <ButtonLink variant="ghost" href="/" onClick={() => goto("basics")}>
        {t("results.simulateAgain")}
      </ButtonLink>
      <Button variant="ghost" onClick={() => setConfirming(true)}>
        {t("results.newRocket")}
      </Button>
    </div>
  );
}
