"use client";

/**
 * Presentational primitives — the "Ethereal Glass" design language (issue #10).
 *
 * Everything here is framework-free (no motion dep) so it stays cheap and
 * composable: the haptic depth comes from the Double-Bezel nested architecture
 * (Surface), the kinetic feel from CSS spring transitions + group-hover physics.
 * No state lives here.
 *
 * "use client" is required because Spinner uses useT() (a React context hook)
 * to localize its label, and Field uses useId(). InfoTip, which does hold
 * state, lives in ./InfoTip and is re-exported below.
 * All callers of this module are already client components.
 *
 * `cn` and `selectClass` live in lib/styles.ts (issue #50), not here — they're
 * plain string helpers, not components, and importing this module shouldn't
 * be the only way to reach them.
 */

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import Link from "next/link";
import { cn, focusRing, inputBase } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { InfoTip } from "@/components/InfoTip";

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
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 text-xs font-semibold uppercase tracking-[0.2em] text-muted transition-colors duration-300 hover:text-foreground",
          focusRing,
        )}
      >
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

type ButtonVariant = "primary" | "ghost" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  withArrow?: boolean;
};

const BUTTON_VARIANTS = {
  primary:
    "bg-foreground text-[#050505] hover:shadow-[0_0_36px_-6px_rgba(34,211,238,0.55)]",
  ghost:
    "text-foreground ring-1 ring-inset ring-white/15 hover:bg-white/[0.06] hover:ring-white/25",
  danger: "bg-rose-500 text-white hover:bg-rose-400",
} as const;

const BUTTON_CIRCLE_TONE = {
  primary: "bg-black/10",
  ghost: "bg-white/10",
  danger: "bg-black/15",
} as const;

/** The pill's classes, shared by Button and ButtonLink so both look identical. */
function buttonClassName(variant: ButtonVariant, withArrow: boolean, className?: string) {
  return cn(
    "group relative inline-flex h-12 items-center justify-center gap-2.5 rounded-full pl-6 text-sm font-medium transition-[background-color,box-shadow,color,transform,opacity] duration-500 ease-[var(--ease-spring)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40",
    focusRing,
    withArrow ? "pr-2" : "pr-6",
    BUTTON_VARIANTS[variant],
    className,
  );
}

function ButtonBody({
  variant,
  withArrow,
  children,
}: {
  variant: ButtonVariant;
  withArrow: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <span className="inline-flex items-center gap-2.5">{children}</span>
      {withArrow && (
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full transition-transform duration-500 ease-[var(--ease-spring)] group-hover:translate-x-1 group-hover:-translate-y-[1px] group-hover:scale-105",
            BUTTON_CIRCLE_TONE[variant],
          )}
        >
          <ArrowIcon />
        </span>
      )}
    </>
  );
}

export function Button({
  variant = "primary",
  withArrow = false,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button className={buttonClassName(variant, withArrow, className)} {...props}>
      <ButtonBody variant={variant} withArrow={withArrow}>
        {children}
      </ButtonBody>
    </button>
  );
}

/**
 * ButtonLink — the same pill for navigation. Actions are buttons, destinations
 * are links: a real <a> keeps Cmd/Ctrl-click, middle-click and "open in new
 * tab" working, which `router.push` from a button cannot.
 */
export function ButtonLink({
  variant = "primary",
  withArrow = false,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & {
  variant?: ButtonVariant;
  withArrow?: boolean;
}) {
  return (
    <Link className={buttonClassName(variant, withArrow, className)} {...props}>
      <ButtonBody variant={variant} withArrow={withArrow}>
        {children}
      </ButtonBody>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Field — label + control slot + inline error. The hint and the error get
// stable ids and are wired to the control (`aria-describedby` /
// `aria-invalid`) so assistive tech reads them with the field; the error is
// an alert so it is announced when validation inserts it.
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
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  // Wire the first element child (the control) without asking every caller to
  // repeat the ids; later siblings (adornments, buttons) are left alone.
  // Explicit props on the child win, so a caller can still override.
  const items = Children.toArray(children);
  const controlIndex = items.findIndex((child) => isValidElement(child));
  const control = items.map((child, index) =>
    index === controlIndex && isValidElement<Record<string, unknown>>(child)
      ? cloneElement(child, {
          "aria-invalid": child.props["aria-invalid"] ?? (error ? true : undefined),
          "aria-describedby": child.props["aria-describedby"] ?? describedBy,
        })
      : child,
  );

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-sm font-medium text-foreground/80">
        {label}
        {term && <InfoTip term={term} />}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputBase, className)} {...props} />;
}

// ---------------------------------------------------------------------------
// SegmentedControl — one-of-N chooser rendered as a pill track (Workbench
// atmosphere model / uncertainty preset). Plain buttons with `aria-pressed`
// inside a labelled group: tabbable, no roving-focus machinery needed, and
// `value: null` means "none pressed" (e.g. a customized preset).
// ---------------------------------------------------------------------------

export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("flex gap-0.5 rounded-[11px] bg-chip p-[3px]", className)}
    >
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-[30px] min-w-0 flex-1 truncate rounded-lg px-2 text-sm transition-[background-color,color,box-shadow] duration-300 ease-[var(--ease-spring)]",
              focusRing,
              pressed ? "bg-surface font-medium text-ink shadow-soft" : "text-ink-2 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
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
  // Theme tokens (S6): soft fill + ink per tone, in both themes.
  const tones = {
    info: "bg-accent-soft text-accent-ink",
    warning: "bg-warn-soft text-warn-ink",
    error: "bg-bad-soft text-bad-ink",
    success: "bg-ok-soft text-ok-ink",
  } as const;
  // Callouts carry async outcomes (validation, fetch failures, confirmations),
  // so they are live regions: errors interrupt, the rest wait politely.
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("break-words rounded-xl px-4 py-3 text-sm", tones[tone])}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1 text-[0.92em] opacity-90")}>{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Spinner
// ---------------------------------------------------------------------------

/**
 * `decorative` hides the spinner from assistive tech. Use it whenever visible
 * loading text sits next to the spinner, otherwise screen readers announce
 * the state twice ("Loading…" from the label plus the text).
 */
export function Spinner({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  const t = useT();
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "status", "aria-label": t("common.loading") } as const);
  return (
    <span
      {...a11y}
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}

// InfoTip holds open/closed state, so it lives in its own module; re-exported
// here so callers keep importing every primitive from one place.
export { InfoTip };
