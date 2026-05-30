/**
 * Tiny homegrown i18n runtime — dependency-free.
 *
 * Usage:
 *   const t = makeT("es");
 *   t("auth.signIn")                          // → "Iniciar sesión"
 *   t("rocket.converting", { filename })      // → "Convirtiendo rocket.json…"
 *   plural("en", 3, "results.valuesBadge")    // → "3 values"
 *
 * MessageKey is the generated union from messages/keys.d.ts — all dot-path
 * keys from en.json. Re-run `npm run i18n:types` after changing en.json.
 *
 * TranslateFn accepts `string` (not the strict union) so that dynamic keys
 * like t(`scalars.${spec.key}`) remain valid TypeScript. IDEs still offer
 * autocomplete for MessageKey literals. The catalog check script + generated
 * union together prevent key drift at the structural level.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Locale = "en" | "es";

/**
 * The generated union of all dot-path keys from en.json.
 * Re-exported here for convenience; source of truth is messages/keys.d.ts.
 */
export type { MessageKey } from "@/messages/keys";

type Catalog = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Catalog registry — populated by LocaleProvider on startup
// ---------------------------------------------------------------------------

const catalogs: Record<Locale, Catalog> = {
  en: {},
  es: {},
};

/**
 * Register the message catalog for a locale. Called once from LocaleProvider
 * after importing en.json / es.json so the module stays dependency-free.
 */
export function registerCatalog(locale: Locale, catalog: Catalog): void {
  catalogs[locale] = catalog;
}

// ---------------------------------------------------------------------------
// Dot-path resolver
// ---------------------------------------------------------------------------

function resolve(catalog: Catalog, key: string): unknown {
  const parts = key.split(".");
  let node: unknown = catalog;
  for (const part of parts) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

// ---------------------------------------------------------------------------
// Interpolation
// ---------------------------------------------------------------------------

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}

// ---------------------------------------------------------------------------
// makeT — factory that returns a bound translator for a given locale
// ---------------------------------------------------------------------------

/**
 * Accepts `string` (not the strict MessageKey union) so dynamic template-
 * literal keys are valid. The MessageKey union is available for IDEs /
 * static-analysis tooling via the named export above.
 */
export type TranslateFn = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export function makeT(locale: Locale): TranslateFn {
  const catalog = catalogs[locale];
  return function t(key, vars) {
    const value = resolve(catalog, key);
    if (typeof value !== "string") {
      if (typeof window !== "undefined") {
        console.warn(`[i18n] Missing key "${key}" for locale "${locale}"`);
      }
      return key;
    }
    return interpolate(value, vars);
  };
}

// ---------------------------------------------------------------------------
// plural — simple one / other helper (count === 1 → .one, else → .other)
// ---------------------------------------------------------------------------

/**
 * Picks the `.one` or `.other` sub-key under `baseKey`, then interpolates
 * `{count}` in the resulting template.
 *
 * Catalog shape example:
 *   "results.valuesBadge": { "one": "1 value", "other": "{count} values" }
 */
export function plural(
  locale: Locale,
  count: number,
  baseKey: string,
): string {
  const t = makeT(locale);
  const form = count === 1 ? "one" : "other";
  return t(`${baseKey}.${form}`, { count });
}
