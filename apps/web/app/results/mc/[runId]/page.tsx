import { Suspense } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { ApiError, type MonteCarloRun } from "@/lib/api";
import type { TranslateFn } from "@/lib/i18n";
import { getMonteCarloServer } from "@/lib/server-api";
import { resolveServerLocale, getServerT } from "@/lib/server-i18n";
import { Callout } from "@/components/ui";
import { ghostButton } from "@/components/ui/classes";
import { MonteCarloReport } from "@/components/results/MonteCarloReport";
import { ResultsSkeleton } from "@/components/results/ResultsSkeleton";

// Server Component: the dispersion report, opened from the /runs
// "Dispersion" table. The run is read on the server (session cookie
// forwarded by lib/server-api.ts) and handed to the MonteCarloReport client
// island, which keeps polling it while it is queued or running. Next 16:
// dynamic route params are async — await before use.
export default async function MonteCarloReportPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  const locale = resolveServerLocale((await cookies()).get("NEXT_LOCALE")?.value);
  const t = getServerT(locale);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 lg:py-8">
      <Suspense fallback={<ResultsSkeleton label={t("mcReport.loading")} />}>
        <MonteCarloReportContent runId={runId} t={t} />
      </Suspense>
    </div>
  );
}

/** Same failure handling as the run report (ResultsContentServer). */
async function MonteCarloReportContent({ runId, t }: { runId: string; t: TranslateFn }) {
  let run: MonteCarloRun;
  try {
    run = await getMonteCarloServer(runId);
  } catch (err) {
    // A 401 means AuthGate (client-side) is about to show the login screen.
    if (err instanceof ApiError && err.isUnauthorized) return null;
    const message =
      err instanceof ApiError
        ? err.status === 404
          ? t("montecarlo.missing")
          : (err.hint ?? t(`errors.${err.code}`, { status: err.status }))
        : t("montecarlo.loadFailed");
    return (
      <div className="flex flex-col gap-4 py-12">
        <Callout tone="error" title={t("mcReport.unavailableTitle")}>
          {message}
        </Callout>
        <div>
          <Link href="/runs" className={ghostButton}>
            {t("mcReport.backToRuns")}
          </Link>
        </div>
      </div>
    );
  }
  return <MonteCarloReport runId={runId} initialRun={run} />;
}
