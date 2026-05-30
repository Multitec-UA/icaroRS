"use client";

/**
 * LocaleProvider — app-wide locale context.
 *
 * Wraps the entire provider tree (outermost inside <body>) so the login
 * screen and every downstream surface can call useT() / useLocale().
 *
 * Locale resolution order (first one wins):
 *   1. initialLocale prop (from server: NEXT_LOCALE cookie read in layout)
 *   2. navigator.language primary subtag on first mount (no cookie)
 *   3. Hard default: "en"
 *
 * setLocale does three things atomically:
 *   1. Updates React state (triggers re-render of all t() consumers)
 *   2. Writes the NEXT_LOCALE cookie (1 year, SameSite=Lax, Secure on https,
 *      NOT httpOnly — must be JS-readable for client-side writes)
 *   3. Updates document.documentElement.lang for a11y / SEO correctness
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
   * Pass the cookie-resolved locale from the server layout, or `null` if no
   * valid cookie was present (first-time visitor). When null, the provider
   * falls back to navigator.language detection on mount.
   */
  initialLocale: Locale | null;
}

export function LocaleProvider({ children, initialLocale }: LocaleProviderProps) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale ?? "en");

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    writeLocaleCookie(l);
    document.documentElement.lang = l;
  }, []);

  // First-visit detection: runs only when the server had no cookie.
  // A single flash from en→es is accepted for first-time Spanish visitors
  // and will never recur (cookie is written on first detect).
  useEffect(() => {
    if (initialLocale !== null) return; // cookie was present — skip detection
    const primary = navigator.language.split("-")[0].toLowerCase();
    if (primary === "es") {
      setLocale("es");
    }
    // Any non-"es" language defaults to "en" (already the initial state).
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // ^ intentionally empty deps — we only want this to run once on mount

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
