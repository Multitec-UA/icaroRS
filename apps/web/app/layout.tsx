import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies } from "next/headers";
import { AuthGate } from "@/components/auth/AuthGate";
import { WizardProvider } from "@/components/wizard/WizardProvider";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const raw = cookieStore.get("NEXT_LOCALE")?.value;
  // Validate: only accept known locales; anything else (e.g. "fr", "") → null
  const locale: Locale | null =
    raw && SUPPORTED_LOCALES.has(raw) ? (raw as Locale) : null;

  return (
    <html
      lang={locale ?? "en"}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-[100dvh] flex flex-col">
        <AmbientBackground />
        {/* LocaleProvider wraps AuthGate so the login screen is also localized.
            initialLocale is null for first-time visitors (no cookie) — the
            provider will detect navigator.language on mount. */}
        <LocaleProvider initialLocale={locale}>
          {/* Auth + wizard state live at the root so they persist across the
              wizard (/) and the results page (/results/[runId]). */}
          <AuthGate>
            <WizardProvider>{children}</WizardProvider>
          </AuthGate>
        </LocaleProvider>
      </body>
    </html>
  );
}
