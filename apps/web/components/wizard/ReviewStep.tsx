"use client";

/**
 * Step 4 — Review & run. Shows a plain-language summary of the scenario, then
 * runs /api/simulate. The simulation is synchronous and can take a while; on
 * success we navigate to the shareable results page.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type FieldError } from "@/lib/api";
import { useSimulateMutation } from "@/lib/queries";
import { formatLaunchDate, toLaunchDate } from "@/lib/domain/scenario";
import { useWizardDraft } from "./WizardProvider";
import { Button, Callout, Eyebrow, Spinner } from "@/components/ui";
import { cn } from "@/lib/styles";
import { useT, useLocale } from "@/components/i18n/LocaleProvider";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/[0.06] py-2.5 text-sm last:border-0">
      <span className="shrink-0 text-muted">{label}</span>
      <span className={cn("min-w-0 break-words text-right font-medium text-foreground", mono && "tabular-readout")}>
        {value}
      </span>
    </div>
  );
}

export function ReviewStep() {
  const { state, setResult, scenarioBody } = useWizardDraft();
  const router = useRouter();
  const t = useT();
  const { locale } = useLocale();
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);
  const simulateMutation = useSimulateMutation();
  const busy = simulateMutation.isPending;

  async function run() {
    if (!state.exportId) return;
    setErrors([]);
    setFatal(null);
    try {
      const result = await simulateMutation.mutateAsync({
        exportId: state.exportId,
        scenario: scenarioBody(),
      });
      setResult(result);
      router.push(`/results/${encodeURIComponent(result.run_id)}`);
    } catch (err) {
      // A 401 is handled globally (lib/query-client.ts).
      if (err instanceof ApiError && err.isUnauthorized) return;
      if (err instanceof ApiError && err.isValidation) setErrors(err.fieldErrors ?? []);
      else if (err instanceof ApiError)
        // If the server sent a hint (503 service note), show it verbatim per RG-6 / design.
        // Otherwise map the stable code to a catalog key.
        setFatal(err.hint ?? t(`errors.${err.code}`, { status: err.status }));
      else setFatal(t("review.errorGeneric"));
    }
  }

  const date = toLaunchDate(state.launchDatetime);
  const site = state.site;

  // Locale-aware number formats: coordinates keep exactly 4 decimals and no
  // grouping (a grouped latitude reads as nonsense); the rest group as the
  // locale does.
  const { coordFormat, numberFormat } = useMemo(
    () => ({
      coordFormat: new Intl.NumberFormat(locale, {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
        useGrouping: false,
      }),
      numberFormat: new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }),
    }),
    [locale],
  );

  // Show the UTC launch hour back in the user's own time zone (with its
  // name), so the summary reads in the same clock the picker was filled in.
  function formatLaunchTime(): string {
    return date ? formatLaunchDate(date, locale) : "—";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>{t("review.eyebrow")}</Eyebrow>
        <h2
          tabIndex={-1}
          className="text-balance text-2xl font-semibold tracking-tight outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        >
          {t("review.heading")}
        </h2>
        <p className="text-sm text-muted">
          {t("review.description")}
        </p>
      </div>

      <div className="rounded-2xl bg-white/[0.02] px-5 py-1 ring-1 ring-inset ring-white/10">
        <Row label={t("review.rowScenario")} value={state.name} />
        <Row
          mono
          label={t("review.rowSite")}
          value={
            site && Number.isFinite(site.latitude)
              ? `${coordFormat.format(site.latitude)}, ${coordFormat.format(site.longitude)}${
                  site.elevation !== null ? ` · ${numberFormat.format(site.elevation)}\u00a0m` : ""
                }`
              : "—"
          }
        />
        <Row
          mono
          label={t("review.rowLaunchTime")}
          value={formatLaunchTime()}
        />
        <Row label={t("review.rowAtmosphere")} value={t(`models.${state.atmosphere.model}`)} />
        <Row
          label={t("review.rowUncertaintyParams")}
          value={
            state.uncertainty
              ? numberFormat.format(Object.keys(state.uncertainty).length)
              : t("review.uncertaintyDefault")
          }
        />
      </div>

      {errors.length > 0 && (
        <Callout tone="error" title={t("review.errorsTitle")}>
          <ul className="list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>
                {e.field ? `${e.field}: ` : ""}
                {e.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {fatal && <Callout tone="error">{fatal}</Callout>}

      <div className="flex items-center justify-end gap-3">
        {/* Always mounted so the "running…" status is announced when it
            appears, not only if the region happened to exist beforehand. */}
        <span aria-live="polite" className="text-sm text-muted">
          {busy && t("review.running")}
        </span>
        <Button onClick={run} disabled={busy}>
          {busy && <Spinner decorative />}
          {busy ? t("review.simulating") : t("review.runSimulation")}
        </Button>
      </div>
    </div>
  );
}
