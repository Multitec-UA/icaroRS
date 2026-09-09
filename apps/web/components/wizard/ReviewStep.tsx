"use client";

/**
 * Step 4 — Review & run. Shows a plain-language summary of the scenario, then
 * runs /api/simulate. The simulation is synchronous and can take a while; on
 * success we navigate to the shareable results page.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type FieldError } from "@/lib/api";
import { useSimulateMutation } from "@/lib/queries";
import { toLaunchDate } from "@/lib/domain/scenario";
import { useWizardDraft } from "./WizardProvider";
import { Button, Callout, Eyebrow, Spinner } from "@/components/ui";
import { cn } from "@/components/ui";
import { useT, useLocale } from "@/components/i18n/LocaleProvider";

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-white/[0.06] py-2.5 text-sm last:border-0">
      <span className="text-muted">{label}</span>
      <span className={cn("text-right font-medium text-foreground", mono && "tabular-readout")}>
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

  // Format the launch time using the active locale for date conventions
  function formatLaunchTime(): string {
    if (!date) return "—";
    // Build a Date object then format with locale conventions
    const d = new Date(Date.UTC(date.year, date.month - 1, date.day, date.hour, 0, 0));
    return d.toLocaleString(locale, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "UTC",
      hour12: false,
    }) + " UTC";
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>{t("review.eyebrow")}</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight">{t("review.heading")}</h2>
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
              ? `${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)}${
                  site.elevation !== null ? ` · ${site.elevation} m` : ""
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
          value={state.uncertainty ? String(Object.keys(state.uncertainty).length) : t("review.uncertaintyDefault")}
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
        {busy && (
          <span className="text-sm text-muted">
            {t("review.running")}
          </span>
        )}
        <Button onClick={run} disabled={busy}>
          {busy && <Spinner />}
          {busy ? t("review.simulating") : t("review.runSimulation")}
        </Button>
      </div>
    </div>
  );
}
