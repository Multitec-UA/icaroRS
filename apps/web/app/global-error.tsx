"use client";

/**
 * Global error boundary — catches failures that escape the root layout
 * itself (e.g. a throw inside LocaleProvider/WizardProvider/AuthGate while
 * app/layout.tsx renders). Next.js unmounts the ENTIRE tree — including
 * LocaleProvider — and swaps this in instead, so it cannot reach useT() /
 * useLocale() via context, and must define its own <html>/<body> and pull
 * in its own global styles (see the Next.js global-error docs).
 *
 * It resolves the locale the same way LocaleProvider persists it — the
 * NEXT_LOCALE cookie — and calls the catalog translator directly, so the
 * copy still comes from messages/en.json and messages/es.json rather than
 * being hardcoded here.
 */

import { useEffect } from "react";
import "./globals.css";
import { makeT, registerCatalog, type Locale } from "@/lib/i18n";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import { GlobalErrorContent } from "@/components/boundaries/GlobalErrorContent";

// This module can be reached without LocaleProvider ever having mounted
// (e.g. a throw during the root layout's own render), so it registers the
// catalogs itself instead of relying on LocaleProvider's module-level call.
registerCatalog("en", enMessages as Record<string, unknown>);
registerCatalog("es", esMessages as Record<string, unknown>);

function readLocale(): Locale {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
  return match?.[1] === "es" ? "es" : "en";
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const locale = readLocale();
  const t = makeT(locale);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang={locale}>
      <body className="flex min-h-[100dvh] items-center justify-center bg-background px-4 text-foreground antialiased">
        <GlobalErrorContent
          title={t("errors.boundaryTitle")}
          message={t("errors.globalMessage")}
          retryLabel={t("errors.tryAgain")}
          onRetry={reset}
        />
      </body>
    </html>
  );
}
