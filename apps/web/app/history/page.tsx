import { Suspense } from "react";
import { cookies } from "next/headers";
import { resolveServerLocale, getServerT } from "@/lib/server-i18n";
import { Eyebrow } from "@/components/ui";
import { HistoryListServer } from "@/components/history/HistoryListServer";
import { HistoryListSkeleton } from "@/components/history/HistoryListSkeleton";

// Server Component (issue #52): the header renders immediately; the list
// (an authenticated read) streams in via Suspense once HistoryListServer's
// fetch resolves. "Re-run" stays a client island (HistoryCard).
export default async function HistoryPage() {
  const locale = resolveServerLocale((await cookies()).get("NEXT_LOCALE")?.value);
  const t = getServerT(locale);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("history.eyebrow")}</Eyebrow>
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("history.heading")}
        </h1>
        <p className="text-sm text-muted">{t("history.description")}</p>
      </header>

      <Suspense fallback={<HistoryListSkeleton label={t("history.loading")} />}>
        <HistoryListServer t={t} />
      </Suspense>
    </div>
  );
}
