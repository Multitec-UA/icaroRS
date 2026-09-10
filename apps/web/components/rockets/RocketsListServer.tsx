/**
 * RocketsListServer — the server-rendered body of /rockets (issue #52).
 *
 * A Server Component: fetches GET /api/rockets directly (lib/server-api.ts,
 * forwarding the session cookie) instead of the client useRocketsQuery from
 * issue #48. Meant to sit inside a <Suspense> boundary in app/rockets/page.tsx
 * so the static header renders immediately and this streams in once the
 * fetch resolves.
 *
 * Renders plain markup; each row's "Use this rocket" interactivity is the
 * <RocketCard> client island.
 */

import { ApiError } from "@/lib/api";
import { getRocketsServer } from "@/lib/server-api";
import type { TranslateFn } from "@/lib/i18n";
import { Callout } from "@/components/ui";
import { RocketCard } from "./RocketCard";

export async function RocketsListServer({ t }: { t: TranslateFn }) {
  let rockets;
  try {
    rockets = await getRocketsServer();
  } catch (err) {
    // A 401 here just means AuthGate (client-side) is about to replace this
    // whole tree with the login screen — nothing to render in the meantime.
    if (err instanceof ApiError && err.isUnauthorized) return null;
    return <Callout tone="error">{t("rockets.errorLoad")}</Callout>;
  }

  if (rockets.length === 0) {
    return <Callout tone="info">{t("rockets.empty")}</Callout>;
  }

  return (
    <div className="flex flex-col gap-4">
      {rockets.map((rocket, i) => (
        <RocketCard key={rocket.rocket_id} rocket={rocket} index={i} />
      ))}
    </div>
  );
}
