"use client";

/** The wizard shell: top bar + stepper + the active step. Results live on their
 * own page (/results/[runId]); this shell drives rocket → review. */

import { useWizard } from "./WizardProvider";
import { Stepper } from "./Stepper";
import { RocketStep } from "./RocketStep";
import { BasicsStep } from "./BasicsStep";
import { AdvancedStep } from "./AdvancedStep";
import { ReviewStep } from "./ReviewStep";
import { useAuth } from "@/components/auth/AuthGate";
import { Card } from "@/components/ui";

export function WizardShell() {
  const { step } = useWizard();
  const { logout } = useAuth();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight text-slate-900">
          icaro <span className="font-normal text-slate-400">· rocket simulation</span>
        </span>
        <button
          type="button"
          onClick={logout}
          className="text-sm text-slate-500 hover:text-slate-800"
        >
          Sign out
        </button>
      </header>

      <Stepper />

      <Card>
        {step === "rocket" && <RocketStep />}
        {step === "basics" && <BasicsStep />}
        {step === "advanced" && <AdvancedStep />}
        {step === "review" && <ReviewStep />}
      </Card>
    </div>
  );
}
