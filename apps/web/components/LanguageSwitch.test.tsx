import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { LanguageSwitch } from "./LanguageSwitch";

/**
 * Issue #54: the group's own aria-label ("Language") was a hardcoded English
 * literal, read aloud verbatim by a screen reader regardless of locale. The
 * per-button labels ("Español"/"English") are deliberately left untranslated
 * — language autonyms, not UI copy (see scripts/i18n-lint.mjs's allowlist).
 */
describe("LanguageSwitch (issue #54 — group aria-label localization)", () => {
  it("localizes the group aria-label in English", () => {
    render(
      <LocaleProvider initialLocale="en">
        <LanguageSwitch />
      </LocaleProvider>,
    );

    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
  });

  it("localizes the group aria-label in Spanish", () => {
    render(
      <LocaleProvider initialLocale="es">
        <LanguageSwitch />
      </LocaleProvider>,
    );

    expect(screen.getByRole("group", { name: "Idioma" })).toBeInTheDocument();
  });
});
