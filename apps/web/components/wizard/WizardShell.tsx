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
import { FadeSwap } from "@/components/motion";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useT } from "@/components/i18n/LocaleProvider";

export function WizardShell() {
  const { step } = useWizard();
  const { logout } = useAuth();
  const t = useT();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <span className="text-lg font-semibold tracking-tight">
          {t("wizard.appName")}{" "}
          <span className="font-normal text-muted">· {t("wizard.appSubtitle")}</span>
        </span>
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <button
            type="button"
            onClick={logout}
            className="rounded-full px-3 py-1.5 text-sm text-muted ring-1 ring-inset ring-white/10 transition-colors duration-300 hover:text-foreground hover:ring-white/25"
          >
            {t("wizard.signOut")}
          </button>
        </div>
      </header>

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
