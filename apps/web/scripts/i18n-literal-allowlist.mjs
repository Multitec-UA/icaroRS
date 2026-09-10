/**
 * Documented exemptions for the untranslated-literal scan in check-i18n.mjs
 * (issue #54 — closing the class of i18n leaks, not just the eight found by
 * hand). Keeping this in its own module makes the exemption list something
 * a reviewer reads on purpose, not a buried exception buried in scan logic.
 *
 * Each entry allows ONE specific literal in ONE specific file. `file` is a
 * POSIX-style path relative to apps/web (matching how the scanner reports
 * findings). `text` must match the exact (trimmed) literal content the
 * scanner would otherwise flag. Being this precise — rather than exempting a
 * whole file or a whole attribute kind — means a *different* new literal in
 * an allowlisted file still gets caught.
 *
 * The scanner warns (without failing) about any entry below that matched
 * nothing during a run, so this list can't silently drift from the code it
 * documents.
 */
export const ALLOWLIST = [
  {
    file: "components/map/MapInner.tsx",
    text: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    reason:
      "Required OpenStreetMap tile attribution (their usage policy, not ours) — a legal notice, not UI copy. Explicitly called out as an exception in issue #54.",
  },
  {
    file: "components/LanguageSwitch.tsx",
    text: "Español",
    reason:
      "Language autonym on the locale-switch button — shown in its own language regardless of the active locale, same convention as the visible ES/EN labels beside it.",
  },
  {
    file: "components/LanguageSwitch.tsx",
    text: "English",
    reason: "Language autonym — see the \"Español\" entry above.",
  },
  {
    file: "components/ui.tsx",
    text: "i",
    reason:
      "InfoTip's single-letter icon glyph (an \"info\" abbreviation, like a lowercase-i badge), not language-bearing text — identical in Spanish. The actual definition text next to it is already translated via useT().",
  },
];
