"use client";

/**
 * Step 5 — Results dashboard. Renders the serialized Flight: headline numbers as
 * cards, the rest in a details table, a plot gallery, and a warnings banner
 * (e.g. when a real forecast fell back to standard atmosphere).
 *
 * Reads the result from the wizard if it's the run we just produced; otherwise
 * (deep link / refresh) fetches it from /api/results/{runId}.
 *
 * Plot PNGs sit behind the Identity Platform session cookie, which the
 * browser attaches automatically to same-origin requests — including a
 * bare <img src>, so no manual authenticated fetch is needed.
 */

import { useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ApiError } from "@/lib/api";
import { useResultQuery } from "@/lib/queries";
import { useWizard } from "@/components/wizard/WizardProvider";
import { SCALAR_SPECS, formatScalar } from "@/lib/scalars";
import { Accordion, Button, Callout, Eyebrow, InfoTip, Spinner, Surface } from "@/components/ui";
import { CountUp, Reveal } from "@/components/motion";
import { useT, useLocale } from "@/components/i18n/LocaleProvider";
import { plural } from "@/lib/i18n";

// Interactive charts (three + echarts) are heavy and client-only — code-split
// them off the initial bundle and keep them out of SSR.
const InteractiveResults = dynamic(
  () => import("@/components/results/InteractiveResults").then((m) => m.InteractiveResults),
  { ssr: false },
);

export function ResultsDashboard({ runId }: { runId: string }) {
  const { state, goto, reset } = useWizard();
  const router = useRouter();
  const t = useT();
  const { locale } = useLocale();

  // Already have it from the wizard (just-produced run) → skip the fetch
  // entirely. Otherwise (deep link / refresh), useResultQuery fetches it.
  const fromWizard = state.result?.run_id === runId ? state.result : null;
  const { data, isLoading, error: queryError } = useResultQuery(runId, {
    enabled: !fromWizard,
  });
  const result = fromWizard ?? data?.result ?? null;
  const loading = !fromWizard && isLoading;

  // Derived at render time (not captured in a closure), so switching language
  // after a failed fetch re-renders with the message in the NEW language
  // instead of the stale one the effect-based version used to capture.
  // A 401 is handled globally (lib/query-client.ts) and unmounts this
  // component via the login screen, so it's deliberately not rendered here.
  const isUnauthorizedError = queryError instanceof ApiError && queryError.isUnauthorized;
  const error =
    queryError && !isUnauthorizedError
      ? queryError instanceof ApiError
        ? // Prefer server hint verbatim (503 service note) per design; otherwise map code to catalog key.
          (queryError.hint ?? t(`errors.${queryError.code}`, { status: queryError.status }))
        : t("results.resultsNotFound")
      : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-32 text-muted">
        <Spinner /> {t("results.loadingResults")}
      </div>
    );
  }
  if (error || !result) {
    return (
      <div className="py-12">
        <Callout tone="error" title={t("results.resultsUnavailableTitle")}>
          {error ?? t("results.resultsNotFound")}
        </Callout>
        <div className="mt-4">
          <Button variant="ghost" onClick={() => router.push("/")}>
            {t("results.backToStart")}
          </Button>
        </div>
      </div>
    );
  }

  const present = (key: string) => key in result.scalars;
  const primary = SCALAR_SPECS.filter((s) => s.primary && present(s.key));
  const details = SCALAR_SPECS.filter((s) => !s.primary && present(s.key));

  function simulateAgain() {
    goto("basics");
    router.push("/");
  }
  function newRocket() {
    reset();
    router.push("/");
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-3">
          <Eyebrow>{t("results.eyebrow")}</Eyebrow>
          <h1 className="text-4xl font-semibold tracking-tight">{t("results.heading")}</h1>
          <p className="tabular-readout text-sm text-muted">{t("results.runId", { runId })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={simulateAgain}>
            {t("results.simulateAgain")}
          </Button>
          <Button variant="ghost" onClick={newRocket}>
            {t("results.newRocket")}
          </Button>
        </div>
      </header>

      {result.warnings.length > 0 && (
        <Callout tone="warning" title={t("results.warningsTitle")}>
          {/* API warnings are English verbatim per RG-6.1 */}
          <ul className="list-disc pl-5">
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          {/* Localized note per AC-6.3/6.4 */}
          <p className="mt-2 text-xs opacity-75">{t("common.technicalEnglishNote")}</p>
        </Callout>
      )}

      {/* Headline numbers */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {primary.map((spec, i) => {
          const value = result.scalars[spec.key];
          const finite = value !== null && Number.isFinite(value);
          return (
            <Reveal key={spec.key} delay={i * 0.08}>
              <Surface className="h-full" innerClassName="flex h-full flex-col gap-3 p-5">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                  {t(`scalars.${spec.key}`)}
                  {spec.term && <InfoTip term={spec.term} />}
                </div>
                <div className="tabular-readout text-3xl font-semibold text-foreground">
                  {finite ? (
                    <CountUp value={value} format={(n) => formatScalar(n, spec.unit, locale)} />
                  ) : (
                    "—"
                  )}
                </div>
              </Surface>
            </Reveal>
          );
        })}
      </section>

      {/* Interactive charts + animated 3D trajectory (issue #11). Renders
          nothing when the run has no series — the PNG gallery below stands in. */}
      <InteractiveResults runId={runId} />

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
                      {formatScalar(result.scalars[spec.key], spec.unit, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Accordion>
      )}

      {/* Static plot gallery (PNGs) — fallback / complete set. */}
      {result.plot_urls.length > 0 && (
        <Accordion
          title={t("results.allPlots")}
          badge={plural(locale, result.plot_urls.length, "results.plotsBadge")}
        >
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {result.plot_urls.map((url, i) => {
              const stem = url.split("/").pop()?.replace(/\.png$/, "") ?? "plot";
              // Resolve plot title from catalog; fall back to humanized stem if key missing
              const title = t(`plots.${stem}`) !== `plots.${stem}`
                ? t(`plots.${stem}`)
                : stem.replace(/_/g, " ");
              return (
                <Reveal key={url} delay={i * 0.05}>
                  <PlotCard url={url} title={title} failedLabel={t("results.couldNotLoadPlot")} />
                </Reveal>
              );
            })}
          </div>
        </Accordion>
      )}
    </div>
  );
}

function PlotCard({ url, title, failedLabel }: { url: string; title: string; failedLabel: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <Surface as="div" innerClassName="overflow-hidden">
      <figure>
        <figcaption className="border-b border-white/[0.06] px-4 py-2.5 text-sm font-medium text-foreground/90">
          {title}
        </figcaption>
        <div className="flex min-h-48 items-center justify-center bg-white p-2">
          {failed ? (
            <span className="py-12 text-sm text-slate-400">{failedLabel}</span>
          ) : (
            // The session cookie is same-origin, so the browser attaches it here too.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={url} alt={title} className="w-full rounded-lg" onError={() => setFailed(true)} />
          )}
        </div>
      </figure>
    </Surface>
  );
}
