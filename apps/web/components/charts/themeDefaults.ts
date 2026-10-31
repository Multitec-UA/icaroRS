"use client";

/**
 * Default chart colours read from the theme tokens (S2): canvas charts
 * (ECharts, three.js) need concrete colour strings, so the defaults resolve
 * the CSS variables through `useThemeTokens` and follow the theme live.
 *
 * Before mount there are no computed styles (SSR, jsdom); the fallback is
 * the light palette as declared in `app/globals.css`, so the first paint is
 * a valid colour rather than an empty string. Keep it in sync with `:root`.
 */

import { useMemo } from "react";
import { useThemeTokens } from "@/components/flight/useThemeTokens";

const TOKENS = ["bg", "surface", "surface-2", "border", "divider", "ink", "muted", "axis", "accent", "peach", "ok", "warn"] as const;
type Token = (typeof TOKENS)[number];

const LIGHT_FALLBACK: Record<Token, string> = {
  bg: "#f3f1f8",
  surface: "#fbfafd",
  "surface-2": "#f0edf6",
  border: "#e2ddec",
  divider: "#ebe7f2",
  ink: "#2b2840",
  muted: "#6e6987",
  axis: "#c9c3da",
  accent: "#6b7fe0",
  peach: "#ee9a72",
  ok: "#5fb38d",
  warn: "#e3a857",
};

/** The resolved theme tokens the charts paint with. */
export function useChartTokens(): Record<Token, string> {
  const live = useThemeTokens(TOKENS);
  return useMemo(() => ({ ...LIGHT_FALLBACK, ...live }), [live]);
}

/** Overlay caller overrides (non-empty values only) on the defaults. */
export function mergePalette<T extends { [K in keyof T]: string }>(defaults: T, overrides?: Partial<T>): T {
  const merged = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = overrides?.[key];
    if (value) merged[key] = value as T[keyof T];
  }
  return merged;
}
