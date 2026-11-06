"use client";

/**
 * MonteCarloExplainer — "How to read these results" (S15): a collapsed native
 * <details> under a finished dispersion run with five plain lines for
 * first-year students: what a Monte Carlo run is, why the result is a spread,
 * and how to use it (target altitude and launch window, safety area from the
 * outer ellipse, which input to measure better).
 */

import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";

const LINES = [
  "montecarlo.explainerWhat",
  "montecarlo.explainerWhy",
  "montecarlo.explainerAltitude",
  "montecarlo.explainerSafety",
  "montecarlo.explainerMeasure",
] as const;

export function MonteCarloExplainer() {
  const t = useT();
  return (
    <details className="group rounded-xl bg-surface-2">
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden",
          focusRing,
        )}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform duration-300 group-open:rotate-90"
        >
          <path d="m5 3 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t("montecarlo.explainerTitle")}
      </summary>
      <ul className="flex list-disc flex-col gap-1.5 px-3 pb-3 pl-8 text-sm leading-relaxed text-ink-2">
        {LINES.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ul>
    </details>
  );
}
