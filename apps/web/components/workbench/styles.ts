/**
 * Class strings shared by the Workbench's own controls (S7/S8). The legacy
 * `Button` in components/ui.tsx is the 48px glass pill of the old wizard;
 * the Workbench uses the canvas's compact 36px controls, built from theme
 * tokens only, so they are kept here as plain strings next to the
 * components that use them.
 */

import { cn, focusRing } from "@/lib/styles";

/** Filled primary action (Run, Convert). */
export const primaryButton = cn(
  "inline-flex h-9 items-center justify-center gap-2 rounded-[9px] bg-primary px-3.5 text-sm font-medium text-on-primary transition-[opacity,transform,box-shadow] duration-300 ease-[var(--ease-spring)] hover:shadow-soft active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  focusRing,
);

/** Outlined secondary action (Cancel, Use, Try another file). */
export const ghostButton = cn(
  "inline-flex h-9 items-center justify-center gap-2 rounded-[9px] border border-border bg-surface px-3 text-sm text-ink transition-[background-color,border-color,transform,opacity] duration-300 ease-[var(--ease-spring)] hover:bg-surface-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  focusRing,
);

/** Small rounded chip (other rockets). */
export const chipButton = cn(
  "inline-flex h-8 max-w-full items-center gap-2 rounded-full bg-chip px-3 text-[13px] text-ink-2 transition-[background-color,color,transform] duration-300 ease-[var(--ease-spring)] hover:bg-accent-soft hover:text-accent-ink active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  focusRing,
);

/** Inline text link inside the Workbench (All rockets, Compare two files). */
export const textLink = cn(
  "rounded-md text-[13px] text-accent-ink transition-colors duration-300 hover:text-ink",
  focusRing,
);
