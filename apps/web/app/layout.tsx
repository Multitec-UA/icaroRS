import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { cookies, headers } from "next/headers";
import { AuthGate } from "@/components/auth/AuthGate";
import { WizardProvider } from "@/components/wizard/WizardProvider";
import { QueryProvider } from "@/components/providers/QueryProvider";
import { AmbientBackground } from "@/components/AmbientBackground";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { resolveLocale, type Locale } from "@/lib/i18n";
import { getServerT } from "@/lib/server-i18n";
import { THEME_COOKIE, resolveThemePreference, themeColorFor, type ThemePreference } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/**
 * Resolve the request's locale from server-visible data only (NEXT_LOCALE
 * cookie → Accept-Language → "en"). Shared by generateMetadata() and the
 * layout itself: Next.js calls them as two independent invocations, so each
 * needs its own resolution, and they must agree — otherwise the tab title
 * could be in a different language than <html lang>.
 */
async function requestLocale(): Promise<Locale> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return resolveLocale(
    cookieStore.get("NEXT_LOCALE")?.value,
    headerStore.get("accept-language"),
  );
}

/**
 * Document metadata is user-facing copy (browser tab, bookmarks, history,
 * link previews, search results), so it goes through the catalog like
 * everything else. It has to be generateMetadata() rather than a static
 * `metadata` export because the locale is only knowable per request.
 *
 * generateMetadata runs on the server outside React, so useT() is
 * unavailable; lib/server-i18n.ts registers both catalogs at import time
 * precisely for this case (same approach as app/not-found.tsx).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = getServerT(await requestLocale());
  return {
    title: t("meta.title"),
    description: t("meta.description"),
  };
}

/** The theme preference lives in a cookie the client writes (ThemeProvider). */
async function requestTheme(): Promise<ThemePreference> {
  const cookieStore = await cookies();
  return resolveThemePreference(cookieStore.get(THEME_COOKIE)?.value);
}

/**
 * Browser chrome colour and UA colour scheme (scrollbars, native inputs) must
 * match the page background, which depends on the theme preference — so this
 * is per request. "system" emits both media-scoped theme-color metas.
 */
export async function generateViewport(): Promise<Viewport> {
  const preference = await requestTheme();
  return {
    themeColor: themeColorFor(preference),
    colorScheme: preference === "system" ? "light dark" : preference,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [locale, theme] = await Promise.all([requestLocale(), requestTheme()]);

  return (
    <html
      lang={locale}
      // An explicit preference is rendered here so the first paint is already
      // in the right theme; "system" renders no attribute and CSS follows the OS.
      data-theme={theme === "system" ? undefined : theme}
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
            <ThemeProvider initialPreference={theme}>
              {/* Auth + wizard state live at the root so they persist across the
                  wizard (/) and the results page (/results/[runId]). WizardProvider
                  wraps AuthGate so the shared nav (AppNav) can reset the wizard form
                  when leaving the results screen. */}
              <WizardProvider>
                <AuthGate>{children}</AuthGate>
              </WizardProvider>
            </ThemeProvider>
          </LocaleProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
