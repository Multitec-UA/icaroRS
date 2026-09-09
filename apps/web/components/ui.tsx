"use client";

/**
 * Presentational primitives — the "Ethereal Glass" design language (issue #10).
 *
 * Everything here is framework-free (no motion dep) so it stays cheap and
 * composable: the haptic depth comes from the Double-Bezel nested architecture
 * (Surface), the kinetic feel from CSS spring transitions + group-hover physics.
 * No state lives here.
 *
 * "use client" is required because InfoTip uses useT() (a React context hook)
 * to resolve glossary definitions from the active locale catalog.
 * All callers of this module are already client components.
 *
 * `cn` and `selectClass` live in lib/styles.ts (issue #50), not here — they're
 * plain string helpers, not components, and importing this module shouldn't
 * be the only way to reach them.
 */

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn, inputBase } from "@/lib/styles";

// ---------------------------------------------------------------------------
// Surface — the Double-Bezel (Doppelrand): a glass plate sitting in a machined
// tray. Outer shell (hairline ring + faint fill) wraps an inner core with its
// own background, an inset top highlight, and a concentric (smaller) radius.
// ---------------------------------------------------------------------------

export function Surface({
  children,
  className,
  innerClassName,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  as?: "div" | "section" | "form";
}) {
  return (
    <Tag className={cn("rounded-[2rem] bg-white/[0.035] p-1.5 ring-1 ring-white/10", className)}>
      <div
        className={cn(
          "rounded-[calc(2rem-0.375rem)] bg-[#0b0b0e] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
          innerClassName,
        )}
      >
        {children}
      </div>
    </Tag>
  );
}

/** Card — a Surface with sensible default padding for content blocks. */
export function Card({
  children,
  className,
  innerClassName,
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
}) {
  return (
    <Surface className={className} innerClassName={cn("p-6 sm:p-8", innerClassName)}>
      {children}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Eyebrow — microscopic pill tag that precedes major headings.
// ---------------------------------------------------------------------------

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-muted ring-1 ring-white/10",
        className,
      )}
    >
      <span className="h-1 w-1 rounded-full bg-cyan-400 shadow-[0_0_8px_2px_rgba(34,211,238,0.6)]" />
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Accordion — glass <details> with an animated chevron. Native (keyboard- and
// screen-reader-friendly, zero JS state); same idiom as the wizard's sections.
// ---------------------------------------------------------------------------

export function Accordion({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-2xl bg-white/[0.02] ring-1 ring-inset ring-white/10 [&_summary::-webkit-details-marker]:hidden"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition-colors duration-300 hover:text-foreground">
        <span>{title}</span>
        <span className="flex items-center gap-3 normal-case tracking-normal">
          {badge != null && <span className="text-[11px] text-muted">{badge}</span>}
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden="true"
            className="transition-transform duration-500 ease-[var(--ease-spring)] group-open:rotate-180"
          >
            <path d="M3 5l4 4 4-4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </summary>
      <div className="px-5 pb-5">{children}</div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// Button — fully-rounded "island" pill. Optional button-in-button trailing
// icon nested in its own circle, with magnetic group-hover physics + press.
// ---------------------------------------------------------------------------

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  withArrow?: boolean;
};

export function Button({
  variant = "primary",
  withArrow = false,
  className,
  children,
  ...props
}: ButtonProps) {
  const base =
    "group relative inline-flex h-12 items-center justify-center gap-2.5 rounded-full pl-6 text-sm font-medium transition-all duration-500 ease-[var(--ease-spring)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40";
  const pad = withArrow ? "pr-2" : "pr-6";
  const variants = {
    primary:
      "bg-foreground text-[#050505] hover:shadow-[0_0_36px_-6px_rgba(34,211,238,0.55)]",
    ghost:
      "text-foreground ring-1 ring-inset ring-white/15 hover:bg-white/[0.06] hover:ring-white/25",
    danger: "bg-rose-500 text-white hover:bg-rose-400",
  } as const;
  const circleTone = {
    primary: "bg-black/10",
    ghost: "bg-white/10",
    danger: "bg-black/15",
  } as const;

  return (
    <button className={cn(base, pad, variants[variant], className)} {...props}>
      <span className="inline-flex items-center gap-2.5">{children}</span>
      {withArrow && (
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-500 ease-[var(--ease-spring)] group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:scale-105",
            circleTone[variant],
          )}
        >
          <ArrowIcon />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Field — label + control slot + inline error
// ---------------------------------------------------------------------------

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  term,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  term?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium text-foreground/80">
        {label}
        {term && <InfoTip term={term} />}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs font-medium text-rose-400">{error}</p>}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Callout — info / warning / error / success banner (tinted glass)
// ---------------------------------------------------------------------------

export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "error" | "success";
  title?: string;
  children?: ReactNode;
}) {
  const tones = {
    info: "ring-cyan-400/20 bg-cyan-400/[0.06] text-cyan-50",
    warning: "ring-amber-400/20 bg-amber-400/[0.06] text-amber-50",
    error: "ring-rose-400/25 bg-rose-500/[0.07] text-rose-50",
    success: "ring-emerald-400/20 bg-emerald-400/[0.06] text-emerald-50",
  } as const;
  return (
    <div className={cn("rounded-2xl px-4 py-3 text-sm ring-1 ring-inset", tones[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1 text-[0.92em] opacity-90")}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------------
// InfoTip — a tiny "i" badge with a native-title definition.
// Definition text is resolved from the active locale catalog via useT().
// ---------------------------------------------------------------------------

import { useT } from "@/components/i18n/LocaleProvider";

export function InfoTip({ term }: { term: string }) {
  const t = useT();
  const key = `glossary.${term}`;
  const def = t(key);
  // If the key is missing (t returns the key itself), render nothing.
  if (def === key) return null;
  return (
    <span
      title={def}
      tabIndex={0}
      aria-label={def}
      className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white/60 transition-colors hover:bg-white/20 hover:text-white/90"
    >
      i
    </span>
  );
}
