"use client";

/**
 * ResultsColumn — the Workbench's right column (S7). A quiet placeholder
 * before the first run; afterwards the run's warnings, headline scalars
 * (ScalarsGrid) and the interactive 3D + series section (InteractiveResults)
 * — the existing results components, restyled later by T8.
 *
 * Errors the input sections could not place next to a field (general 422
 * messages, 503 hints, network failures) are shown here, above the results.
 */

import type { FieldError } from "@/lib/api";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Callout } from "@/components/ui";
import { FadeSwap } from "@/components/motion";
import { InteractiveResultsLazy } from "@/components/results/InteractiveResultsLazy";
import { ScalarsGrid } from "@/components/results/ScalarsGrid";
import { useT } from "@/components/i18n/LocaleProvider";
import { unplacedErrors } from "./fieldErrors";
import { InfoIcon } from "./icons";

export function ResultsColumn({ errors, fatal }: { errors: FieldError[]; fatal: string | null }) {
  const t = useT();
  const { state } = useWizardDraft();
  const result = state.result;
  const general = unplacedErrors(errors);

  return (
    <section aria-label={t("workbench.results")} className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-5">
      {fatal && <Callout tone="error">{fatal}</Callout>}
      {general.length > 0 && (
        <Callout tone="error" title={t("review.errorsTitle")}>
          <ul className="list-disc pl-5">
            {general.map((e, i) => (
              <li key={i}>
                {e.field ? `${e.field}: ` : ""}
                {e.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {result ? (
        <FadeSwap key={result.run_id} className="flex flex-col gap-4">
          {result.warnings.length > 0 && (
            <Callout tone="warning" title={t("results.warningsTitle")}>
              {/* API warnings are English verbatim per RG-6.1 */}
              <ul className="list-disc pl-5">
                {result.warnings.map((w, i) => (
                  <li key={i} className="break-words">
                    {w}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs opacity-75">{t("common.technicalEnglishNote")}</p>
            </Callout>
          )}
          <ScalarsGrid scalars={result.scalars} />
          <InteractiveResultsLazy runId={result.run_id} />
        </FadeSwap>
      ) : (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <InfoIcon className="shrink-0 text-muted" />
          {t("workbench.resultsPlaceholder")}
        </div>
      )}
    </section>
  );
}
