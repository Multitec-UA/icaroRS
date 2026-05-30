/**
 * Aerospace glossary — term registry.
 *
 * Definitions now live in the i18n catalogs (messages/en.json + es.json)
 * under the `glossary.*` namespace, keyed by these term strings.
 *
 * Usage in components:
 *   t("glossary." + term)  → localized definition
 *
 * The GLOSSARY_TERMS set is kept for type-checking / exhaustiveness guard
 * (T-27 will generate a typed union once the full catalog is locked).
 */

export const GLOSSARY_TERMS = [
  "apogee",
  "mach",
  "rail_departure",
  "stability_margin",
  "forecast",
  "standard_atmosphere",
  "uncertainty",
] as const;

export type GlossaryTerm = typeof GLOSSARY_TERMS[number];
