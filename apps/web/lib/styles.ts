/**
 * Plain className helpers (issue #50) — no React, no components. Split out of
 * components/ui.tsx so that module exports only actual UI components, and
 * this module can be imported from anywhere without pulling in a component
 * library's worth of JSX.
 */

export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

const inputBase =
  "h-12 w-full rounded-xl bg-white/[0.03] px-4 text-sm text-foreground outline-none ring-1 ring-inset ring-white/10 transition-all duration-300 ease-[var(--ease-spring)] placeholder:text-white/25 focus:bg-white/[0.05] focus:ring-2 focus:ring-cyan-400/40";

export { inputBase };

/** Shared class for native <select> elements so they match TextInput. */
export const selectClass = cn(inputBase, "cursor-pointer appearance-none");
