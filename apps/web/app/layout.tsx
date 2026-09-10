import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { AuthGate } from "@/components/auth/AuthGate";
import { WizardProvider } from "@/components/wizard/WizardProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AmbientBackground } from "@/components/AmbientBackground";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import type { Locale } from "@/lib/i18n";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "icaro · rocket simulation",
  description: "Run a rocket flight simulation from your OpenRocket design.",
};

const SUPPORTED_LOCALES = new Set<string>(["en", "es"]);

/**
 * Resolve the initial locale entirely on the server so the first paint already
 * has the right language — no client flash, no setState-in-effect:
 *   1. NEXT_LOCALE cookie (explicit user choice) wins.
 *   2. Otherwise, the highest-priority supported language in Accept-Language.
 *   3. Hard default: "en".
 */
function resolveLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (cookieValue && SUPPORTED_LOCALES.has(cookieValue)) {
    return cookieValue as Locale;
  }
  if (acceptLanguage) {
    const ranked = acceptLanguage
      .split(",")
      .map((part) => {
        const [tag, ...params] = part.trim().split(";");
        const q = params.find((p) => p.trim().startsWith("q="));
        const weight = q ? Number.parseFloat(q.trim().slice(2)) : 1;
        return { primary: tag.trim().split("-")[0].toLowerCase(), weight };
      })
      .sort((a, b) => b.weight - a.weight);
    for (const { primary } of ranked) {
      if (SUPPORTED_LOCALES.has(primary)) return primary as Locale;
    }
  }
  return "en";
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get("NEXT_LOCALE")?.value,
    headerStore.get("accept-language"),
  );

  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-[100dvh] flex flex-col">
        <AmbientBackground />
        {/* QueryProvider is outermost so the server-state layer (issue #48) is
            available regardless of auth status — it holds one QueryClient for
            the tab's lifetime rather than being recreated on every login. */}
        <QueryProvider>
          {/* LocaleProvider wraps AuthGate so the login screen is also localized.
              initialLocale is fully resolved server-side (cookie → Accept-Language
              → "en"), so the first render is already in the right language. */}
          <LocaleProvider initialLocale={locale}>
            {/* Auth + wizard state live at the root so they persist across the
                wizard (/) and the results page (/results/[runId]). WizardProvider
                wraps AuthGate so the shared nav (AppNav) can reset the wizard form
                when leaving the results screen. */}
            <WizardProvider>
              <AuthGate>{children}</AuthGate>
            </WizardProvider>
          </LocaleProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
