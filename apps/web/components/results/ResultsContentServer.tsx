/**
 * ResultsContentServer — the server-rendered body of /results/[runId], the
 * Run report (S9, canvas board C).
 *
 * A Server Component: fetches GET /api/results/{runId} directly
 * (lib/server-api.ts, forwarding the session cookie) and renders what needs
 * no client state itself — the warnings, "All results" (every scalar with
 * its catalog label) and the plot gallery. The parts that need the browser
 * are client islands with serialisable props:
 *   - ReportHeader: breadcrumb, "{rocket} over {site}", file · date · author
 *     and the actions. The results envelope carries only the numbers, so the
 *     header looks the run up in the history (useRunSummaryQuery);
 *   - ReportFlight: the flight replay (series via useSeriesQuery, the PNG
 *     plots stand in on 404) and the KPI cards with their sparklines;
 *   - ReportConfiguration: the stored scenario as a definition list.
 *
 * Known trade-off (unchanged from issue #52): a Server Component cannot read
 * the just-simulated result held in WizardProvider, so the Workbench → report
 * navigation always does one server-side fetch.
 */

import Link from "next/link";
import { SCALAR_SPECS, formatScalar } from "@/lib/scalars";
import { ApiError, type SimulateResult } from "@/lib/api";
import { getResultServer } from "@/lib/server-api";
import type { Locale, TranslateFn } from "@/lib/i18n";
import { Callout } from "@/components/ui";
import { PlotGallery } from "@/components/flight/PlotGallery";
import { ReplayProvider } from "@/components/flight/ReplayContext";
import { WarningsBanner } from "@/components/flight/WarningsBanner";
import { ghostButton } from "@/components/workbench/styles";
import { ReportConfiguration } from "./ReportConfiguration";
import { ReportFlight } from "./ReportFlight";
import { ReportHeader } from "./ReportHeader";

export async function ResultsContentServer({
  runId,
  t,
  locale,
}: {
  runId: string;
  t: TranslateFn;
  locale: Locale;
}) {
  let result: SimulateResult;

  try {
    result = (await getResultServer(runId)).result;
  } catch (err) {
    // A 401 here just means AuthGate (client-side) is about to replace this
    // whole tree with the login screen — nothing to render in the meantime.
    if (err instanceof ApiError && err.isUnauthorized) return null;
    const message =
      err instanceof ApiError
        ? (err.hint ?? t(`errors.${err.code}`, { status: err.status }))
        : t("results.resultsNotFound");
    return (
      <div className="flex flex-col gap-4 py-12">
        <Callout tone="error" title={t("results.resultsUnavailableTitle")}>
          {message}
        </Callout>
        <div>
          <Link href="/" className={ghostButton}>
            {t("results.backToStart")}
          </Link>
        </div>
      </div>
    );
  }

  const { scalars, warnings, plot_urls: plotUrls } = result;
  const allResults = SCALAR_SPECS.filter((spec) => spec.key in scalars);

  return (
    <ReplayProvider>
      <ReportHeader runId={runId} />

      <ReportFlight runId={runId} scalars={scalars} />

      <WarningsBanner warnings={warnings} />

      <div className="grid gap-4 lg:grid-cols-2">
        <section
          aria-labelledby="report-all-results"
          className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-soft"
        >
          <h2 id="report-all-results" className="text-sm font-semibold text-ink">
            {t("report.allResults")}
          </h2>
          <dl className="flex flex-col text-sm">
            {allResults.map((spec) => (
              <div
                key={spec.key}
                className="flex items-baseline justify-between gap-4 border-t border-divider py-2 first:border-t-0"
              >
                <dt className="text-ink-2">{t(`scalars.${spec.key}`)}</dt>
                <dd className="tabular-nums font-medium text-ink">{formatScalar(scalars[spec.key], spec.unit, locale)}</dd>
              </div>
            ))}
          </dl>
        </section>

        <ReportConfiguration runId={runId} />
      </div>

      {/* The complete set of static plots, whether or not the run has series. */}
      <PlotGallery urls={plotUrls} />
    </ReplayProvider>
  );
}
