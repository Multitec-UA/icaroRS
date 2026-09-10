"use client";

/** The wizard shell: stepper + the active step. Navigation lives in AppNav
 * (app-level, shared across all authenticated pages). Results live on their
 * own page (/results/[runId]); this shell drives rocket → review. */

import { useWizardNav } from "./WizardProvider";
import { Stepper } from "./Stepper";
import { RocketStep } from "./RocketStep";
import { BasicsStep } from "./BasicsStep";
import { AdvancedStep } from "./AdvancedStep";
import { ReviewStep } from "./ReviewStep";
import { Card } from "@/components/ui";
import { FadeSwap } from "@/components/motion";

export function WizardShell() {
  // Nav-only (issue #50) — see Stepper.tsx for why this matters.
  const { step } = useWizardNav();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
      <Stepper />

      <Card>
        <FadeSwap key={step}>
          {step === "rocket" && <RocketStep />}
          {step === "basics" && <BasicsStep />}
          {step === "advanced" && <AdvancedStep />}
          {step === "review" && <ReviewStep />}
        </FadeSwap>
      </Card>
    </div>
  );
}
