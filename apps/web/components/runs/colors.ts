/**
 * The three colours the /runs board gives the overlaid runs, in selection
 * order: a Tailwind class for dots and chips, and the theme token the SVG
 * overlay resolves through useThemeTokens. One source so the table, the
 * legend and the "What changed" headers agree on which run is which.
 */

export const RUN_COLORS = [
  { dot: "bg-accent", token: "accent" },
  { dot: "bg-peach", token: "peach" },
  { dot: "bg-ok", token: "ok" },
] as const;

export type RunColorToken = (typeof RUN_COLORS)[number]["token"];

/** How many runs can be overlaid at once — one colour each. */
export const MAX_OVERLAY = RUN_COLORS.length;
