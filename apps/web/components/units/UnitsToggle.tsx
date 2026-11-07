"use client";

/**
 * UnitsToggle — one button that flips between metric and imperial units.
 * `aria-pressed` reflects "imperial is on"; the accessible name says what a
 * press will do, mirroring ThemeToggle.
 */

import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { useUnits } from "./UnitsProvider";

export function UnitsToggle({ className }: { className?: string }) {
  const t = useT();
  const { system, toggle } = useUnits();
  const imperial = system === "imperial";
  const name = imperial ? t("units.switchToMetric") : t("units.switchToImperial");

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={imperial}
      aria-label={name}
      title={name}
      className={cn(
        "inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-border bg-surface-2 px-2.5 font-mono text-[11px] font-medium uppercase tracking-wide text-ink-2 transition-[background-color,color,transform] duration-300 ease-[var(--ease-spring)] hover:text-ink active:scale-[0.96] pointer-coarse:min-h-11",
        focusRing,
        className,
      )}
    >
      {imperial ? t("units.imperialShort") : t("units.metricShort")}
    </button>
  );
}
