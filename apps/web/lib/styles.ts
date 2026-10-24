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
  "h-12 w-full rounded-xl bg-white/[0.03] px-4 text-sm text-foreground outline-none ring-1 ring-inset ring-white/10 transition-[background-color,box-shadow,color] duration-300 ease-[var(--ease-spring)] placeholder:text-white/25 focus-visible:bg-white/[0.05] focus-visible:ring-2 focus-visible:ring-cyan-400/40";

export { inputBase };

/**
 * Focus ring shared by every interactive element that is not a text control
 * (buttons, links, summaries). Pair it with `outline-none`.
 */
export const focusRing =
  "outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]";

/**
 * Shared class for native <select> elements so they match TextInput. Options
 * get an explicit background/color: Windows renders the native popup with the
 * OS theme otherwise, which makes translucent dark options unreadable.
 */
export const selectClass = cn(
  inputBase,
  "cursor-pointer appearance-none [&>option]:bg-[#0b0b0e] [&>option]:text-foreground",
);
