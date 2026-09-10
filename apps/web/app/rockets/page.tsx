import { Suspense } from "react";
import { cookies } from "next/headers";
import { resolveServerLocale, getServerT } from "@/lib/server-i18n";
import { Eyebrow } from "@/components/ui";
import { RocketsListServer } from "@/components/rockets/RocketsListServer";
import { RocketsListSkeleton } from "@/components/rockets/RocketsListSkeleton";

// Server Component (issue #52): the header renders immediately; the list
// (an authenticated read) streams in via Suspense once RocketsListServer's
// fetch resolves. "Use this rocket" stays a client island (RocketCard).
export default async function RocketsPage() {
  const locale = resolveServerLocale((await cookies()).get("NEXT_LOCALE")?.value);
  const t = getServerT(locale);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("rockets.eyebrow")}</Eyebrow>
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("rockets.heading")}
        </h1>
        <p className="text-sm text-muted">{t("rockets.description")}</p>
      </header>

      <Suspense fallback={<RocketsListSkeleton label={t("rockets.loading")} />}>
        <RocketsListServer t={t} />
      </Suspense>
    </div>
  );
}
