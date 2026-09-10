/**
 * Global not-found page — shown for any URL that doesn't match a route.
 *
 * `/results/[runId]` is a deep-linkable, shareable route, so a stale,
 * mistyped, or expired link is a realistic entry point rather than an edge
 * case. (A missing *result* for a syntactically valid runId is handled
 * inline by ResultsDashboard's own "not found" state, not this file — this
 * one only fires for URLs Next.js cannot route at all.)
 *
 * A Server Component, like app/layout.tsx, so it resolves the locale the
 * same way (cookie → Accept-Language → "en") via the shared helper, and
 * registers the catalogs itself rather than relying on LocaleProvider's
 * client-only module-level side effect having already run.
 */

import { cookies, headers } from "next/headers";
import { makeT, registerCatalog, resolveLocale } from "@/lib/i18n";
import enMessages from "@/messages/en.json";
import esMessages from "@/messages/es.json";
import { NotFoundContent } from "@/components/boundaries/NotFoundContent";

registerCatalog("en", enMessages as Record<string, unknown>);
registerCatalog("es", esMessages as Record<string, unknown>);

export default async function NotFound() {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const locale = resolveLocale(
    cookieStore.get("NEXT_LOCALE")?.value,
    headerStore.get("accept-language"),
  );
  const t = makeT(locale);

  return (
    <NotFoundContent
      title={t("notFound.title")}
      message={t("notFound.message")}
      backLabel={t("notFound.backHome")}
    />
  );
}
