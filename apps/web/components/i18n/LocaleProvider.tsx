"use client";

/**
 * LocaleProvider — app-wide locale context.
 *
 * Wraps the entire provider tree (outermost inside <body>) so the login
 * screen and every downstream surface can call useT() / useLocale().
 *
 * Locale is resolved entirely on the server (NEXT_LOCALE cookie → Accept-Language
 * → "en") and passed in via `initialLocale`, so the first paint is already in the
 * right language — no client-side detection, no flash, no setState-in-effect.
 *
 * setLocale does four things atomically:
 *   1. Updates React state (triggers re-render of all t() consumers)
 *   2. Writes the NEXT_LOCALE cookie (1 year, SameSite=Lax, Secure on https,
 *      NOT httpOnly — must be JS-readable for client-side writes)
 *   3. Updates document.documentElement.lang for a11y / SEO correctness
 *   4. Calls router.refresh() (issue #52) — /rockets, /history, and
 *      /results/[runId] now render their static text server-side via
 *      lib/server-i18n.ts, reading the SAME NEXT_LOCALE cookie this just
 *      wrote. Without a refresh, that server-rendered text would stay in
 *      the old language until the next navigation — router.refresh() re-runs
 *      the Server Components for the current route (re-fetching data too,
 *      since lib/server-api.ts's `cache: "no-store"` route is already
 *      dynamic) so it picks up the new cookie immediately, just like every
 *      client-rendered t() consumer already does.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { makeT, registerCatalog, type Locale, type TranslateFn } from "@/lib/i18n";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";

// Register catalogs once at module evaluation time.
// JSON imports are safe here: resolveJsonModule is enabled in tsconfig.
registerCatalog("en", enMessages as Record<string, unknown>);
registerCatalog("es", esMessages as Record<string, unknown>);

// ---------------------------------------------------------------------------
// Context shape
// ---------------------------------------------------------------------------

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: TranslateFn;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

// ---------------------------------------------------------------------------
// Cookie helper — client-side only
// ---------------------------------------------------------------------------

const COOKIE_NAME = "NEXT_LOCALE";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year in seconds

function writeLocaleCookie(locale: Locale): void {
  const secure =
    typeof window !== "undefined" && window.location.protocol === "https:"
      ? "; Secure"
      : "";
  document.cookie = `${COOKIE_NAME}=${locale}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

interface LocaleProviderProps {
  children: ReactNode;
  /**
   * The locale resolved on the server (cookie → Accept-Language → "en").
   * Always a concrete locale, so the first client render matches the server.
   */
  initialLocale: Locale;
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const router = useRouter();

  const setLocale = useCallback(
    (l: Locale) => {
      setLocaleState(l);
      writeLocaleCookie(l);
      document.documentElement.lang = l;
      router.refresh();
    },
    [router],
  );

  const t = useMemo(() => makeT(locale), [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Consumer hooks
// ---------------------------------------------------------------------------

/** Returns `{ locale, setLocale }`. Must be used inside <LocaleProvider>. */
export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within <LocaleProvider>");
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}

/** Returns the bound translator `t`. Must be used inside <LocaleProvider>. */
export function useT(): TranslateFn {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT must be used within <LocaleProvider>");
  return ctx.t;
}
