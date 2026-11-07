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
  "stability_margin_wind",
  "forecast",
  "standard_atmosphere",
  // Monte Carlo dispersion results (S15)
  "mc_counts",
  "mc_apogee_stats",
  "mc_histogram",
  "mc_ellipses",
  // Launch-day advisor: the sweep and one term per L1 check (launch-day S6b)
  "ld_sweep",
  "ld_apogee_max",
  "ld_apogee_recommended",
  "ld_tilt_max",
  "ld_static_margin_min",
  "ld_descent_max",
  "ld_descent_recommended",
  "ld_landing_radius",
  "ld_rail_exit_min",
  "ld_wind_max",
] as const;

export type GlossaryTerm = typeof GLOSSARY_TERMS[number];
