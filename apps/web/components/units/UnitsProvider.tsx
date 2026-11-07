"use client";

/**
 * UnitsProvider — app-wide unit system (metric / imperial).
 *
 * `initialSystem` is resolved on the server from the `icaro-units` cookie
 * (app/layout.tsx), so the first client render matches the server and there
 * is no flash of metric before imperial. `setSystem` updates React state and
 * writes the cookie atomically, the same way ThemeProvider does.
 *
 * `format(value, kind)` is the one call every visible measurement should use:
 * it converts the SI value the API returns and appends the right label.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useLocale } from "@/components/i18n/LocaleProvider";
import type { Locale } from "@/lib/i18n";
import {
  UNITS_COOKIE,
  UNITS_COOKIE_MAX_AGE,
  formatMeasure,
  fromSi,
  toSi,
  unitLabel,
  type MeasureKind,
  type UnitSystem,
} from "@/lib/units";

interface UnitsContextValue {
  system: UnitSystem;
  setSystem: (system: UnitSystem) => void;
  toggle: () => void;
  /** SI value → `"2,678 ft"` in the current system and locale. */
  format: (value: number | null | undefined, kind: MeasureKind) => string;
  /** SI value → number in the current display unit (for inputs and charts). */
  display: (value: number, kind: MeasureKind) => number;
  /** Number typed in the current display unit → SI (for the scenario body). */
  si: (value: number, kind: MeasureKind) => number;
  /** `"ft"`, `"ft/s"`, `"mph"`… for the current system. */
  label: (kind: MeasureKind) => string;
}

const UnitsContext = createContext<UnitsContextValue | null>(null);

function unitsValue(
  system: UnitSystem,
  locale: Locale,
  setSystem: (system: UnitSystem) => void,
  toggle: () => void,
): UnitsContextValue {
  return {
    system,
    setSystem,
    toggle,
    format: (v, kind) => formatMeasure(v, kind, system, locale),
    display: (v, kind) => fromSi(v, kind, system),
    si: (v, kind) => toSi(v, kind, system),
    label: (kind) => unitLabel(kind, system),
  };
}

const noop = () => {};

function writeUnitsCookie(system: UnitSystem): void {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${UNITS_COOKIE}=${system}; max-age=${UNITS_COOKIE_MAX_AGE}; path=/; SameSite=Lax${secure}`;
}

export function UnitsProvider({
  children,
  initialSystem,
}: {
  children: ReactNode;
  initialSystem: UnitSystem;
}) {
  const [system, setSystemState] = useState<UnitSystem>(initialSystem);
  const { locale } = useLocale();

  const setSystem = useCallback((next: UnitSystem) => {
    setSystemState(next);
    writeUnitsCookie(next);
  }, []);

  const toggle = useCallback(
    () => setSystem(system === "imperial" ? "metric" : "imperial"),
    [system, setSystem],
  );

  const value = useMemo(
    () => unitsValue(system, locale, setSystem, toggle),
    [system, setSystem, toggle, locale],
  );

  return <UnitsContext.Provider value={value}>{children}</UnitsContext.Provider>;
}

/**
 * The unit system in effect. Outside a <UnitsProvider> (isolated component
 * tests, embeds) it is metric in the current locale — exactly what the app
 * rendered before the switch existed — and changing it is a no-op.
 */
export function useUnits(): UnitsContextValue {
  const ctx = useContext(UnitsContext);
  const { locale } = useLocale();
  const fallback = useMemo(() => unitsValue("metric", locale, noop, noop), [locale]);
  return ctx ?? fallback;
}
