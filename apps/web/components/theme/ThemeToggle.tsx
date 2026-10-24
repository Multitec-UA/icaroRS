"use client";

/**
 * ThemeToggle — one button that flips between the pastel light and soft dark
 * themes. `aria-pressed` reflects "dark is on"; the accessible name says what
 * a press will do, so screen-reader users never have to guess the state.
 */

import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { useTheme } from "./ThemeProvider";

function SunIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { resolved, toggle } = useTheme();
  const isDark = resolved === "dark";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={isDark}
      aria-label={isDark ? t("theme.switchToLight") : t("theme.switchToDark")}
      title={isDark ? t("theme.switchToLight") : t("theme.switchToDark")}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-ink-2 ring-1 ring-inset ring-border transition-[background-color,color,transform] duration-300 ease-[var(--ease-spring)] hover:text-ink active:scale-[0.96]",
        focusRing,
        className,
      )}
    >
      {isDark ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </button>
  );
}
