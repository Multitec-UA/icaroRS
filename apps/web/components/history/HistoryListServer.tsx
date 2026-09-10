/**
 * HistoryListServer — the server-rendered body of /history (issue #52).
 *
 * A Server Component: fetches GET /api/history directly (lib/server-api.ts,
 * forwarding the session cookie) instead of the client useHistoryQuery from
 * issue #48. Meant to sit inside a <Suspense> boundary in
 * app/history/page.tsx so the static header renders immediately and this
 * streams in once the fetch resolves.
 *
 * Renders plain markup; each row's "Re-run" interactivity is the
 * <HistoryCard> client island.
 */

import { ApiError } from "@/lib/api";
import { getHistoryServer } from "@/lib/server-api";
import type { TranslateFn } from "@/lib/i18n";
import { Callout } from "@/components/ui";
import { HistoryCard } from "./HistoryCard";

export async function HistoryListServer({ t }: { t: TranslateFn }) {
  let items;
  try {
    items = await getHistoryServer();
  } catch (err) {
    // A 401 here just means AuthGate (client-side) is about to replace this
    // whole tree with the login screen — nothing to render in the meantime.
    if (err instanceof ApiError && err.isUnauthorized) return null;
    return <Callout tone="error">{t("history.errorLoad")}</Callout>;
  }

  if (items.length === 0) {
    return <Callout tone="info">{t("history.empty")}</Callout>;
  }

  return (
    <div className="flex flex-col gap-4">
      {items.map((item, i) => (
        <HistoryCard key={item.simulation_id} item={item} index={i} />
      ))}
    </div>
  );
}
