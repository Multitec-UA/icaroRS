/**
 * Server-side translation (issue #52).
 *
 * `useT()` (components/i18n/LocaleProvider.tsx) is a React context hook —
 * unusable from a Server Component. The underlying translator (`makeT`,
 * lib/i18n.ts) is plain data + a plain function, so it works anywhere; the
 * only React-specific part is `registerCatalog`, normally called once by
 * LocaleProvider's module top-level code. That module is a "use client"
 * component, so on the server it only runs when React actually renders it —
 * an ordering a Server Component that calls `makeT()` before that happens
 * cannot rely on. This module registers both catalogs itself at import
 * time (idempotent — same data either way) so any Server Component can
 * import `getServerT` with no ordering dependency on the client tree.
 *
 * Locale resolution here is deliberately the NEXT_LOCALE-cookie-only subset
 * of app/layout.tsx's `resolveLocale` (cookie → Accept-Language → "en") —
 * not the full precedence. Duplicating the Accept-Language ranking here
 * would conflict with issue #49's extraction of that same function into
 * lib/i18n.ts; once that lands, this should call the shared implementation
 * instead. Missing only the Accept-Language step means a first-time visitor
 * with no NEXT_LOCALE cookie yet sees English server-rendered content even
 * if their browser prefers Spanish — the same "en" default the app already
 * falls back to, just without the extra ranking step.
 */

import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import { makeT, registerCatalog, type Locale, type TranslateFn } from "./i18n";

registerCatalog("en", enMessages as Record<string, unknown>);
registerCatalog("es", esMessages as Record<string, unknown>);

const SUPPORTED_LOCALES = new Set<string>(["en", "es"]);

/** Cookie-only locale resolution — see the module doc for why. */
export function resolveServerLocale(cookieValue: string | undefined): Locale {
  if (cookieValue && SUPPORTED_LOCALES.has(cookieValue)) {
    return cookieValue as Locale;
  }
  return "en";
}

export function getServerT(locale: Locale): TranslateFn {
  return makeT(locale);
}
