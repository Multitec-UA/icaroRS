"use client";

/**
 * LanguageSwitch — ES ↔ EN segmented toggle.
 *
 * Reads/writes locale via the LocaleProvider context. No page reload,
 * no navigation — setLocale updates state in-place, preserving WizardProvider.
 *
 * Visual language: the kit's chip track (same as SegmentedControl). The
 * active segment is a raised surface on ink; the inactive one is muted. No
 * flags.
 */

import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";

/**
 * `name` is the language autonym (not UI copy, never translated). It is read
 * with the visible code so the accessible name contains what sighted users
 * see (WCAG 2.5.3 Label in Name), and `lang` lets screen readers pronounce it.
 */
const LOCALES = [
  { value: "es", label: "ES", name: "Español" },
  { value: "en", label: "EN", name: "English" },
] as const;

export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const t = useT();

  return (
    <div
      role="group"
      aria-label={t("nav.language")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full bg-chip p-[3px]",
        className,
      )}
    >
      {LOCALES.map(({ value, label, name }) => {
        const active = locale === value;
        return (
          <button
            key={value}
            type="button"
            lang={value}
            aria-label={`${label} · ${name}`}
            aria-pressed={active}
            onClick={() => setLocale(value)}
            className={cn(
              "rounded-full px-3 py-1 text-xs font-medium tracking-wide transition-[background-color,color,box-shadow] duration-300 ease-[var(--ease-spring)] pointer-coarse:min-h-11",
              focusRing,
              active
                ? "bg-surface text-ink shadow-soft"
                : "text-muted hover:text-ink",
            )}
          >
            <span translate="no">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
