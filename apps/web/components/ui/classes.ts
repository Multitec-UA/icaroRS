/**
 * Class builders of the control kit (S2). Plain strings, no React, so the
 * Workbench (`components/workbench/styles.ts`), server components and the
 * kit's own primitives all share one definition. Tokens only: every colour
 * comes from `app/globals.css`, never a literal.
 */

import { cn, focusRing } from "@/lib/styles";

export type ButtonVariant = "primary" | "ghost" | "chip" | "danger";
export type ButtonSize = "md" | "sm" | "icon";

/** Shape shared by every button: 36 px, radius 9, spring press. */
const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-[background-color,border-color,color,box-shadow,opacity,transform] duration-300 ease-[var(--ease-spring)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 pointer-coarse:min-h-11";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "rounded-[9px] border border-transparent bg-primary text-on-primary hover:shadow-soft",
  ghost: "rounded-[9px] border border-border bg-surface text-ink hover:bg-surface-2",
  danger: "rounded-[9px] border border-transparent bg-bad-soft text-bad-ink hover:shadow-soft",
  // Chips are full-round and one step smaller in type.
  chip: "max-w-full rounded-full border border-transparent bg-chip text-[13px] text-ink-2 hover:bg-accent-soft hover:text-accent-ink",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: "h-9 px-3.5",
  sm: "h-8 px-3 text-[13px]",
  // Icon-only: a 32 px square. Padding is never overridden from outside: cn()
  // concatenates without merging, so an extra px-0 next to px-3 would lose
  // to CSS order and squeeze the 16 px glyph.
  icon: "h-8 w-8",
};

export function buttonClass({
  variant = "primary",
  size,
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  // Chips are 32 px by design; everything else defaults to 36 px.
  const resolved = size ?? (variant === "chip" ? "sm" : "md");
  return cn(BUTTON_BASE, BUTTON_SIZES[resolved], BUTTON_VARIANTS[variant], focusRing, className);
}

/** Filled primary action (Run, Convert). */
export const primaryButton = buttonClass({ variant: "primary" });
/** Outlined secondary action (Cancel, Use, Try another file). */
export const ghostButton = buttonClass({ variant: "ghost" });
/** Small rounded chip (other rockets, filters). */
export const chipButton = buttonClass({ variant: "chip" });

/** Inline text link (All rockets, Compare two files). */
export const textLink = cn(
  "rounded-md text-[13px] text-accent-ink underline-offset-4 transition-colors duration-300 hover:text-ink",
  focusRing,
);

/** Text controls: 36 px, radius 9, bordered surface; a graphite ring on focus (red is brand or error). */
export const inputClass =
  "h-9 w-full min-w-0 rounded-[9px] border border-border bg-surface px-3 text-sm text-ink outline-none transition-[background-color,border-color,box-shadow,color] duration-300 ease-[var(--ease-spring)] placeholder:text-muted disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted focus-visible:border-ink-2 focus-visible:ring-2 focus-visible:ring-ink/20 aria-[invalid=true]:border-bad pointer-coarse:min-h-11";

/**
 * Native select matching the input, with a token-coloured chevron. Options get
 * an explicit background/colour: Windows draws the popup with the OS theme
 * otherwise.
 */
export const selectControlClass = cn(
  inputClass,
  "cursor-pointer appearance-none bg-[linear-gradient(45deg,transparent_50%,var(--muted)_50%),linear-gradient(135deg,var(--muted)_50%,transparent_50%)] bg-[length:5px_5px] bg-[position:calc(100%-17px)_50%,calc(100%-12px)_50%] bg-no-repeat pr-8 [&>option]:bg-surface [&>option]:text-ink",
);

export type Tone = "ok" | "warn" | "bad" | "neutral";

/** Soft fill + ink per tone; one map for pills, callouts and banners. */
export const toneClass: Record<Tone, string> = {
  ok: "bg-ok-soft text-ok-ink",
  warn: "bg-warn-soft text-warn-ink",
  bad: "bg-bad-soft text-bad-ink",
  neutral: "bg-chip text-ink-2",
};

/** The raised card surface (14 px radius, hairline border, soft shadow). */
export const cardClass = "rounded-[14px] border border-border bg-surface shadow-soft";

/** Floating panels: popovers, menus, suggestion lists. */
export const popoverClass = "rounded-xl border border-border bg-surface text-ink shadow-soft-lg";
