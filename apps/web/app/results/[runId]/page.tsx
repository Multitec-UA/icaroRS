import { Suspense } from "react";
import { cookies } from "next/headers";
import { resolveServerLocale, getServerT } from "@/lib/server-i18n";
import { ResultsContentServer } from "@/components/results/ResultsContentServer";
import { ResultsSkeleton } from "@/components/results/ResultsSkeleton";

// Server Component (issue #52): the headline scalars + details table stream
// in via Suspense once ResultsContentServer's fetch resolves. The
// interactive charts stay ssr:false client components (unchanged); the
// wizard-navigation buttons and the plot-fallback state are client islands.
// Next 16: dynamic route params are async — await before use.
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const locale = resolveServerLocale((await cookies()).get("NEXT_LOCALE")?.value);
  const t = getServerT(locale);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12">
      <Suspense fallback={<ResultsSkeleton label={t("results.loadingResults")} />}>
        <ResultsContentServer runId={runId} t={t} locale={locale} />
      </Suspense>
    </div>
  );
}
