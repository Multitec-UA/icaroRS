"use client";

/**
 * ResultsActions — "Simulate again" / "New rocket" (issue #52). A client
 * island: both drive the client-side WizardProvider (goto/reset are
 * nav-only — see WizardProvider.tsx's issue #50 context split) before
 * navigating back to the wizard root.
 */

import { useRouter } from "next/navigation";
import { useWizardNav } from "@/components/wizard/WizardProvider";
import { Button } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";

export function ResultsActions() {
  const t = useT();
  const router = useRouter();
  const { goto, reset } = useWizardNav();

  function simulateAgain() {
    goto("basics");
    router.push("/");
  }
  function newRocket() {
    reset();
    router.push("/");
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="ghost" onClick={simulateAgain}>
        {t("results.simulateAgain")}
      </Button>
      <Button variant="ghost" onClick={newRocket}>
        {t("results.newRocket")}
      </Button>
    </div>
  );
}
