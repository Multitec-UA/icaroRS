import { Suspense } from "react";
import { cookies } from "next/headers";
import { resolveServerLocale, getServerT } from "@/lib/server-i18n";
import { RocketsListServer } from "@/components/rockets/RocketsListServer";
import { RocketsListSkeleton } from "@/components/rockets/RocketsListSkeleton";

// Server Component (issue #52): the header renders immediately; the list
// (an authenticated read) streams in via Suspense once RocketsListServer's
// fetch resolves. "Use this rocket" stays a client island (RocketCard).
export default async function RocketsPage() {
  const locale = resolveServerLocale((await cookies()).get("NEXT_LOCALE")?.value);
  const t = getServerT(locale);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{t("rockets.heading")}</h1>
        <p className="text-sm text-muted">{t("rockets.description")}</p>
      </header>

      <Suspense fallback={<RocketsListSkeleton label={t("rockets.loading")} />}>
        <RocketsListServer t={t} />
      </Suspense>
    </div>
  );
}
