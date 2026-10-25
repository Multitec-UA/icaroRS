import { Suspense } from "react";
import { cookies } from "next/headers";
import { resolveServerLocale, getServerT } from "@/lib/server-i18n";
import { RunsView } from "@/components/runs/RunsView";
import { RunsSkeleton } from "@/components/runs/RunsSkeleton";

// Server Component shell (S9, canvas board B): the heading renders at once
// and the runs board streams in. RunsView is a client component — it reads
// `?rocket_id=` and owns the baseline / compare selection — and a component
// that calls useSearchParams has to sit under a Suspense boundary.
export default async function RunsPage() {
  const locale = resolveServerLocale((await cookies()).get("NEXT_LOCALE")?.value);
  const t = getServerT(locale);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-ink">{t("runs.heading")}</h1>
        <p className="text-sm text-muted">{t("runs.description")}</p>
      </header>

      <Suspense fallback={<RunsSkeleton label={t("runs.loading")} />}>
        <RunsView />
      </Suspense>
    </div>
  );
}
