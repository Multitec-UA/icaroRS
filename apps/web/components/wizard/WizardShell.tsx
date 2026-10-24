"use client";

/** The wizard shell: stepper + the active step. Navigation lives in AppNav
 * (app-level, shared across all authenticated pages). Results live on their
 * own page (/results/[runId]); this shell drives rocket → review. */

import { useEffect, useRef } from "react";
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
  const contentRef = useRef<HTMLDivElement>(null);
  // Swapping steps replaces the whole subtree, which drops keyboard/screen-
  // reader focus back to <body>. Move it to the new step's heading (each
  // step h2 is `tabIndex={-1}`) — but not on first mount, where the page
  // itself just loaded and stealing focus would be rude.
  const lastFocusedStep = useRef(step);
  useEffect(() => {
    if (lastFocusedStep.current === step) return;
    lastFocusedStep.current = step;
    contentRef.current?.querySelector<HTMLElement>("h2")?.focus();
  }, [step]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-8">
      <Stepper />

      <Card>
        <div ref={contentRef}>
          <FadeSwap key={step}>
            {step === "rocket" && <RocketStep />}
            {step === "basics" && <BasicsStep />}
            {step === "advanced" && <AdvancedStep />}
            {step === "review" && <ReviewStep />}
          </FadeSwap>
        </div>
      </Card>
    </div>
  );
}
