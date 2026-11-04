import { describe, expect, it } from "vitest";
import { THEME_COLORS, THEME_COOKIE, resolveThemePreference, themeColorFor } from "./theme";

describe("resolveThemePreference", () => {
  it("accepts the two explicit themes and treats anything else as system", () => {
    expect(resolveThemePreference("light")).toBe("light");
    expect(resolveThemePreference("dark")).toBe("dark");
    expect(resolveThemePreference(undefined)).toBe("system");
    expect(resolveThemePreference("")).toBe("system");
    expect(resolveThemePreference("blue")).toBe("system");
  });

  it("names the cookie the client writes and the server reads", () => {
    expect(THEME_COOKIE).toBe("icaro-theme");
  });
});

describe("themeColorFor", () => {
  it("returns one colour for an explicit theme and both media variants for system", () => {
    expect(themeColorFor("light")).toBe(THEME_COLORS.light);
    expect(themeColorFor("dark")).toBe(THEME_COLORS.dark);
    expect(themeColorFor("system")).toEqual([
      { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
      { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
    ]);
  });

  it("never uses pure black or white", () => {
    for (const c of Object.values(THEME_COLORS)) {
      expect(c.toLowerCase()).not.toBe("#000000");
      expect(c.toLowerCase()).not.toBe("#ffffff");
    }
  });
});
