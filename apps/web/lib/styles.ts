/**
 * Plain className helpers (issue #50) — no React, no components. Split out of
 * components/ui.tsx so that module exports only actual UI components, and
 * this module can be imported from anywhere without pulling in a component
 * library's worth of JSX.
 */

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/**
 * `outline-none` is safe here only because the `focus-visible:ring-2` below
 * replaces it; transitions list their properties explicitly (no `transition-all`).
 */
const inputBase =
  "h-12 w-full rounded-xl bg-surface px-4 text-sm text-ink outline-none ring-1 ring-inset ring-border transition-[background-color,box-shadow,color] duration-300 ease-[var(--ease-spring)] placeholder:text-muted/70 focus-visible:bg-surface-2 focus-visible:ring-2 focus-visible:ring-accent/50";

export { inputBase };

/**
 * Focus ring shared by every interactive element that is not a text control
 * (buttons, links, summaries). Pair it with `outline-none`.
 */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";

/**
 * Shared class for native <select> elements so they match TextInput. Options
 * get an explicit background/color: Windows renders the native popup with the
 * OS theme otherwise, which makes translucent dark options unreadable.
 */
export const selectClass = cn(
  inputBase,
  "cursor-pointer appearance-none [&>option]:bg-surface [&>option]:text-ink",
);
