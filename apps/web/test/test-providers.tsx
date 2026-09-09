import type { ReactNode } from "react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { WizardProvider } from "@/components/wizard/WizardProvider";
import { AuthGate } from "@/components/auth/AuthGate";

/**
 * Full provider stack mirroring app/layout.tsx, for route-level smoke tests.
 *
 * Every route-owning component reaches for context from all three providers
 * (useT/useLocale, useWizard, useAuth), so a smoke test needs the whole
 * stack, not just the one component under test.
 *
 * Requires `getIdentity` (from "@/lib/api") to be mocked to resolve — AuthGate
 * starts in a "checking" state and only renders `children` once it settles
 * into "authed".
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <LocaleProvider initialLocale="en">
      <WizardProvider>
        <AuthGate>{children}</AuthGate>
      </WizardProvider>
    </LocaleProvider>
  );
}
