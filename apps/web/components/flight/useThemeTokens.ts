"use client";

/**
 * Resolve theme CSS variables (`--accent`, `--surface-2`, …) to concrete
 * colour strings for the canvas-based charts, which cannot read CSS
 * variables themselves. Re-reads when the theme attribute on <html> changes
 * (ThemeProvider toggles `data-theme`) and when the OS scheme flips, so the
 * 3D scene and the ECharts palette follow the pastel light / soft dark
 * themes live. Empty until mounted: SSR has no computed styles.
 */

import { useEffect, useMemo, useState } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

function readTokens(names: readonly string[]): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = style.getPropertyValue(`--${name}`).trim();
    if (value) out[name] = value;
  }
  return out;
}

export function useThemeTokens<const K extends readonly string[]>(
  names: K,
): Partial<Record<K[number], string>> {
  const key = names.join(",");
  const [tokens, setTokens] = useState<Record<string, string>>({});

  useEffect(() => {
    const list = key.split(",");
    const update = () => setTokens(readTokens(list));
    update();

    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const mql = typeof window.matchMedia === "function" ? window.matchMedia(DARK_QUERY) : null;
    mql?.addEventListener("change", update);
    return () => {
      observer.disconnect();
      mql?.removeEventListener("change", update);
    };
  }, [key]);

  return useMemo(() => tokens as Partial<Record<K[number], string>>, [tokens]);
}
