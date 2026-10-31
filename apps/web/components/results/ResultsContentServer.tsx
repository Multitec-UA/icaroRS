/**
 * ResultsContentServer — the server-rendered body of /results/[runId], the
 * Run report (S9, canvas board C).
 *
 * A Server Component: fetches GET /api/results/{runId} directly
 * (lib/server-api.ts, forwarding the session cookie) and hands the envelope
 * to client islands with serialisable props:
 *   - ReportHeader: breadcrumb, "{rocket} over {site}", file · date · author
 *     and the actions. The results envelope carries only the numbers, so the
 *     header looks the run up in the history (useRunSummaryQuery);
 *   - ReportRunResults: RunResults (S7), the one results composition the
 *     Workbench renders too — warnings, replay, KPIs, the OpenRocket row,
 *     series, timeline, "All results" and "Plots";
 *   - ReportConfiguration: the stored scenario and the rocket card.
 * Print rules (app/globals.css) hide the sidebar and the actions.
 *
 * Known trade-off (unchanged from issue #52): a Server Component cannot read
 * the just-simulated result held in WizardProvider, so the Workbench → report
 * navigation always does one server-side fetch.
 */

import Link from "next/link";
import { ApiError, type SimulateResult } from "@/lib/api";
import { getResultServer } from "@/lib/server-api";
import type { Locale, TranslateFn } from "@/lib/i18n";
import { Callout } from "@/components/ui";
import { ReplayProvider } from "@/components/flight/ReplayContext";
import { ghostButton } from "@/components/ui/classes";
import { ReportConfiguration } from "./ReportConfiguration";
import { ReportHeader } from "./ReportHeader";
import { ReportRunResults } from "./ReportRunResults";

export async function ResultsContentServer({
  runId,
  t,
}: {
  runId: string;
  t: TranslateFn;
  /** The request's locale; the client islands read their own from LocaleProvider. */
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

  const { scalars, warnings, plot_urls } = result;

  return (
    <ReplayProvider>
      <ReportHeader runId={runId} />
      <ReportRunResults runId={runId} result={{ scalars, warnings, plot_urls }} />
      <ReportConfiguration runId={runId} />
    </ReplayProvider>
  );
}
