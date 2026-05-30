"use client";

/**
 * LanguageSwitch — ES ↔ EN segmented toggle.
 *
 * Reads/writes locale via the LocaleProvider context. No page reload,
 * no navigation — setLocale updates state in-place, preserving WizardProvider.
 *
 * Visual language: inline-pill matching the WizardShell "Sign out" button
 * (Ethereal Glass design language). Active segment is white/foreground;
 * inactive segment is muted. No flags.
 */

import { useLocale } from "@/components/i18n/LocaleProvider";
import { cn } from "@/components/ui";

const LOCALES = [
  { value: "es", label: "ES" },
  { value: "en", label: "EN" },
] as const;

export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();

  return (
    <div
      role="group"
      aria-label="Language"
      className={cn(
        "inline-flex items-center rounded-full ring-1 ring-inset ring-white/10",
        className,
      )}
    >
      {LOCALES.map(({ value, label }) => {
        const active = locale === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={value === "es" ? "Español" : "English"}
            aria-pressed={active}
            onClick={() => setLocale(value)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium tracking-wide transition-colors duration-300",
              active
                ? "text-foreground"
                : "text-muted hover:text-foreground",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
