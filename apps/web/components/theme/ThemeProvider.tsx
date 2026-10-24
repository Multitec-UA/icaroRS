"use client";

/**
 * ThemeProvider — app-wide theme context (pastel light / soft dark).
 *
 * `initialPreference` is resolved on the server from the `icaro-theme` cookie
 * (app/layout.tsx), and the layout already rendered `data-theme` on <html>
 * for an explicit preference, so the first client render matches the server.
 *
 * "system" renders no attribute and lets CSS follow `prefers-color-scheme`;
 * the resolved value exposed here comes from `matchMedia` through
 * useSyncExternalStore (server snapshot: "light") so it never causes a
 * hydration mismatch and tracks OS changes live.
 *
 * setPreference does three things atomically: updates React state, writes
 * (or clears) the cookie, and sets (or removes) `data-theme` on <html>.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { THEME_COOKIE, THEME_COOKIE_MAX_AGE, type Theme, type ThemePreference } from "@/lib/theme";

interface ThemeContextValue {
  preference: ThemePreference;
  /** What is actually shown: the explicit preference, or the OS theme for "system". */
  resolved: Theme;
  setPreference: (preference: ThemePreference) => void;
  /** Flip to the opposite of what is shown, as an explicit preference. */
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToSystem(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mql = window.matchMedia(DARK_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function readSystemTheme(): Theme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

function writeThemeCookie(preference: ThemePreference): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  const maxAge = preference === "system" ? 0 : THEME_COOKIE_MAX_AGE;
  const value = preference === "system" ? "" : preference;
  document.cookie = `${THEME_COOKIE}=${value}; max-age=${maxAge}; path=/; SameSite=Lax${secure}`;
}

function applyThemeAttribute(preference: ThemePreference): void {
  if (preference === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = preference;
}

export function ThemeProvider({
  children,
  initialPreference,
}: {
  children: ReactNode;
  initialPreference: ThemePreference;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const system = useSyncExternalStore(subscribeToSystem, readSystemTheme, () => "light" as Theme);
  const resolved: Theme = preference === "system" ? system : preference;

  // The server already rendered the attribute for an explicit preference; this
  // keeps <html> in sync after client-side changes (and on first mount, which
  // is a no-op for the server-rendered value).
  useEffect(() => {
    applyThemeAttribute(preference);
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeThemeCookie(next);
    applyThemeAttribute(next);
  }, []);

  const toggle = useCallback(
    () => setPreference(resolved === "dark" ? "light" : "dark"),
    [resolved, setPreference],
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference, toggle }),
    [preference, resolved, setPreference, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
