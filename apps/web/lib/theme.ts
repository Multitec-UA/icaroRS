/**
 * Theme preference — plain data and pure helpers, no React.
 *
 * The app ships two palettes (see app/globals.css): a pastel light theme and
 * a soft dark theme, neither of which uses pure black or white. The choice is
 * stored in a cookie the client writes and the root layout reads, so the
 * server can set `data-theme` on <html> before the first paint (no flash).
 * With no cookie the preference is "system" and CSS follows
 * `prefers-color-scheme`.
 */

export type Theme = "light" | "dark";
export type ThemePreference = Theme | "system";

export const THEME_COOKIE = "icaro-theme";
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/** Page background per theme — must match `--bg` in app/globals.css. */
export const THEME_COLORS: Record<Theme, string> = {
  light: "#F3F1F8",
  dark: "#1E1D2A",
};

export function resolveThemePreference(cookieValue: string | undefined | null): ThemePreference {
  return cookieValue === "light" || cookieValue === "dark" ? cookieValue : "system";
}

/** `themeColor` for Next's viewport: one colour, or both media variants for "system". */
export function themeColorFor(preference: ThemePreference) {
  if (preference === "system") {
    return [
      { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
    ];
  }
  return THEME_COLORS[preference];
}
