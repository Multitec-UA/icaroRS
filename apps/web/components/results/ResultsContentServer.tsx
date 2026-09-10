/**
 * ResultsContentServer — the server-rendered body of /results/[runId]
 * (issue #52).
 *
 * A Server Component: fetches GET /api/results/{runId} directly
 * (lib/server-api.ts, forwarding the session cookie) instead of the client
 * useResultQuery from issue #48. Renders the headline scalars and details
 * table server-side; the interactive charts (InteractiveResults, already
 * `ssr:false`) and every stateful bit (ScalarsGrid's CountUp animation,
 * PlotCard's onError fallback, ResultsActions' wizard navigation) are client
 * islands.
 *
 * Known trade-off: the previous client-only ResultsDashboard could skip the
 * fetch entirely when the wizard had just produced this exact run
 * (`state.result` in WizardProvider). A Server Component can't read that
 * client-side context, so the just-simulated → view-results navigation now
 * always does one server-side fetch it didn't need to before. Every other
 * case (deep link, refresh, "Re-run" from history) already fetched and is
 * strictly faster now (server-rendered instead of a client loading spinner).
 */

import Link from "next/link";
import { SCALAR_SPECS, formatScalar } from "@/lib/scalars";
import { ApiError } from "@/lib/api";
import { getResultServer } from "@/lib/server-api";
import { plural, type Locale, type TranslateFn } from "@/lib/i18n";
import { Accordion, Callout, Eyebrow } from "@/components/ui";
import { ScalarsGrid } from "./ScalarsGrid";
import { PlotCard } from "./PlotCard";
import { ResultsActions } from "./ResultsActions";
import { InteractiveResultsLazy } from "./InteractiveResultsLazy";

// Matches components/ui.tsx's Button ghost variant (no `withArrow`) — a
// server-rendered <Link> needs no client onClick, unlike Button itself.
const backLinkClassName =
  "group relative inline-flex h-12 items-center justify-center gap-2.5 rounded-full px-6 text-sm font-medium transition-all duration-500 ease-[var(--ease-spring)] active:scale-[0.98] text-foreground ring-1 ring-inset ring-white/15 hover:bg-white/[0.06] hover:ring-white/25";

export async function ResultsContentServer({
  runId,
  t,
  locale,
}: {
  runId: string;
  t: TranslateFn;
  locale: Locale;
}) {
  let scalars: Record<string, number | null>;
  let warnings: string[];
  let plotUrls: string[];

  try {
    const env = await getResultServer(runId);
    scalars = env.result.scalars;
    warnings = env.result.warnings;
    plotUrls = env.result.plot_urls;
  } catch (err) {
    // A 401 here just means AuthGate (client-side) is about to replace this
    // whole tree with the login screen — nothing to render in the meantime.
    if (err instanceof ApiError && err.isUnauthorized) return null;
    const message =
      err instanceof ApiError
        ? (err.hint ?? t(`errors.${err.code}`, { status: err.status }))
        : t("results.resultsNotFound");
    return (
      <div className="py-12">
        <Callout tone="error" title={t("results.resultsUnavailableTitle")}>
          {message}
        </Callout>
        <div className="mt-4">
          <Link href="/" className={backLinkClassName}>
            <span className="inline-flex items-center gap-2.5">{t("results.backToStart")}</span>
          </Link>
        </div>
      </div>
    );
  }

  const present = (key: string) => key in scalars;
  const details = SCALAR_SPECS.filter((s) => !s.primary && present(s.key));

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Eyebrow>{t("results.eyebrow")}</Eyebrow>
          <h1 className="text-4xl font-semibold tracking-tight">{t("results.heading")}</h1>
          <p className="tabular-readout text-sm text-muted">{t("results.runId", { runId })}</p>
        </div>
        <ResultsActions />
      </header>

      {warnings.length > 0 && (
        <Callout tone="warning" title={t("results.warningsTitle")}>
          {/* API warnings are English verbatim per RG-6.1 */}
          <ul className="list-disc pl-5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {/* Localized note per AC-6.3/6.4 */}
          <p className="mt-2 text-xs opacity-75">{t("common.technicalEnglishNote")}</p>
        </Callout>
      )}

      <ScalarsGrid scalars={scalars} />

      {/* Interactive charts + animated 3D trajectory (issue #11). Renders
          nothing when the run has no series — the PNG gallery below stands in. */}
      <InteractiveResultsLazy runId={runId} />

      {/* Secondary detail — collapsed by default so the hero + interactive
          section stays the focus. "More numbers" before the static plots. */}
      {details.length > 0 && (
        <Accordion
          title={t("results.moreNumbers")}
          badge={plural(locale, details.length, "results.valuesBadge")}
        >
          <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-white/10">
            <table className="w-full text-sm">
              <tbody>
                {details.map((spec) => (
                  <tr key={spec.key} className="border-t border-white/[0.06] first:border-0">
                    <td className="px-4 py-3 text-muted">{t(`scalars.${spec.key}`)}</td>
                    <td className="tabular-readout px-4 py-3 text-right font-medium text-foreground">
                      {formatScalar(scalars[spec.key], spec.unit, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion>
      )}

      {/* Static plot gallery (PNGs) — fallback / complete set. */}
      {plotUrls.length > 0 && (
        <Accordion
          title={t("results.allPlots")}
          badge={plural(locale, plotUrls.length, "results.plotsBadge")}
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {plotUrls.map((url, i) => {
              const stem = url.split("/").pop()?.replace(/\.png$/, "") ?? "plot";
              // Resolve plot title from catalog; fall back to humanized stem if key missing
              const title =
                t(`plots.${stem}`) !== `plots.${stem}` ? t(`plots.${stem}`) : stem.replace(/_/g, " ");
              return (
                <PlotCard
                  key={url}
                  url={url}
                  title={title}
                  failedLabel={t("results.couldNotLoadPlot")}
                  index={i}
                />
              );
            })}
          </div>
        </Accordion>
      )}
    </>
  );
}
