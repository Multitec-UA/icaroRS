import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { WizardProvider } from "@/components/wizard/WizardProvider";
import { AuthGate } from "@/components/auth/AuthGate";

/**
 * Full provider stack mirroring app/layout.tsx, for route-level smoke tests.
 *
 * Every route-owning component reaches for context from all four providers
 * (useQuery/useMutation, useT/useLocale, useWizard, useAuth), so a smoke test
 * needs the whole stack, not just the one component under test.
 *
 * Requires `getIdentity` (from "@/lib/api") to be mocked to resolve — AuthGate
 * starts in a "checking" state and only renders `children` once it settles
 * into "authed".
 *
 * The QueryClient is created fresh per render (not the app's browser
 * singleton from lib/query-client.ts) so tests never share cached data with
 * each other, and retries are off so a mocked rejection surfaces immediately.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="en">
        <WizardProvider>
          <AuthGate>{children}</AuthGate>
        </WizardProvider>
      </LocaleProvider>
    </QueryClientProvider>
  );
}
