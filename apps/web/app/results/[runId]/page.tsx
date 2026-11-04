import { Suspense } from "react";
import { cookies } from "next/headers";
import { resolveServerLocale, getServerT } from "@/lib/server-i18n";
import { ResultsContentServer } from "@/components/results/ResultsContentServer";
import { ResultsSkeleton } from "@/components/results/ResultsSkeleton";

// Server Component (issue #52): the Run report (S9) streams in via Suspense
// once ResultsContentServer's fetch resolves. The flight replay, the header
// (which looks the run up in the history) and the configuration list are
// client islands. Next 16: dynamic route params are async — await before use.
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const locale = resolveServerLocale((await cookies()).get("NEXT_LOCALE")?.value);
  const t = getServerT(locale);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 lg:py-8">
      <Suspense fallback={<ResultsSkeleton label={t("results.loadingResults")} />}>
        <ResultsContentServer runId={runId} t={t} locale={locale} />
      </Suspense>
    </div>
  );
}
