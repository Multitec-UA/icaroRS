"use client";

/**
 * ResultsColumn — the Workbench's right column (S7/S8).
 *
 * What it shows depends on the import state and the active export:
 *   - no export, nothing importing (A1): the `.ork` drop zone and, when the
 *     org has rockets, "Or pick one already converted";
 *   - a file picked and waiting for its destination: the DestinationCard;
 *   - converting / failed (A2): the ImportStatusCard, honest about progress;
 *   - an export active before the first run: the quiet placeholder;
 *   - after a run (S9): warnings → flight replay → KPI cards → series panel
 *     → flight timeline, from `components/flight/`. While the series loads
 *     the replay and the chart are skeletons; when the series is missing
 *     (404 — a run from before the feature) the KPIs and the timeline stay,
 *     the static PNG plots stand in for the replay and the chart.
 *
 * Errors the input sections could not place next to a field (general 422
 * messages, 503 hints, network failures) are shown here, above the results.
 */

import { ApiError, type FieldError, type SimulateResult } from "@/lib/api";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { useRocketsQuery, useSeriesQuery } from "@/lib/queries";
import { Callout } from "@/components/ui";
import { FadeSwap } from "@/components/motion";
import { FlightReplay } from "@/components/flight/FlightReplay";
import { FlightSkeleton } from "@/components/flight/FlightSkeleton";
import { FlightTimeline } from "@/components/flight/FlightTimeline";
import { KpiCards } from "@/components/flight/KpiCards";
import { PlotGallery } from "@/components/flight/PlotGallery";
import { ReplayProvider } from "@/components/flight/ReplayContext";
import { SeriesPanel } from "@/components/flight/SeriesPanel";
import { WarningsBanner } from "@/components/flight/WarningsBanner";
import { useT } from "@/components/i18n/LocaleProvider";
import { unplacedErrors } from "./fieldErrors";
import { InfoIcon } from "./icons";
import { ImportDropZone } from "./ImportDropZone";
import { RocketPicker } from "./RocketPicker";
import { DestinationCard } from "./DestinationCard";
import { ImportStatusCard } from "./ImportStatusCard";
import type { OrkImport } from "./useOrkImport";

export function ResultsColumn({
  errors,
  fatal,
  importer,
}: {
  errors: FieldError[];
  fatal: string | null;
  importer: OrkImport;
}) {
  const t = useT();
  const { state } = useWizardDraft();
  const rockets = useRocketsQuery();
  const result = state.result;
  const general = unplacedErrors(errors);
  const { phase } = importer;
  const hasExport = state.exportId !== null;

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

      {phase.kind === "choosing" && (
        <DestinationCard
          file={phase.file}
          rockets={rockets.data ?? []}
          loadingRockets={rockets.isPending}
          onConvert={importer.confirm}
          onCancel={importer.cancel}
        />
      )}
      {(phase.kind === "converting" || phase.kind === "failed") && (
        <ImportStatusCard phase={phase} onRetry={importer.cancel} />
      )}

      {result ? (
        <FadeSwap key={result.run_id} className="flex flex-col gap-4">
          <ReplayProvider>
            <RunResults result={result} />
          </ReplayProvider>
        </FadeSwap>
      ) : hasExport || phase.kind !== "idle" ? (
        <div className="flex items-center gap-2.5 rounded-xl border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-ink-2">
          <InfoIcon className="shrink-0 text-muted" />
          {t("workbench.resultsPlaceholder")}
        </div>
      ) : (
        <>
          <ImportDropZone
            title={t("workbench.dropTitle")}
            hint={
              <>
                {t("workbench.dropHint")} <span className="text-accent-ink underline">{t("workbench.dropBrowse")}</span>
              </>
            }
            note={t("workbench.dropNote")}
            inputLabel={t("rocket.fileInputLabel")}
            inputName="rocket-file"
            onFile={(file) => importer.pick(file)}
          />
          <RocketPicker />
        </>
      )}
    </section>
  );
}

/**
 * One run's results. Lives below ResultsColumn so the series query only
 * exists once there is a run to fetch for (hooks cannot be conditional).
 * A 401 logs the user out globally (lib/query-client.ts); a 404 is the
 * normal "no series" of a run that predates the feature.
 */
function RunResults({ result }: { result: SimulateResult }) {
  const t = useT();
  const series = useSeriesQuery(result.run_id);
  const data = series.data;
  const hasPath = Array.isArray(data?.path3d) && data.path3d.length >= 2;
  const notFound = series.isError && series.error instanceof ApiError && series.error.status === 404;
  const failed = series.isError && !notFound;
  const message = series.error instanceof Error ? series.error.message : null;

  return (
    <>
      <WarningsBanner warnings={result.warnings} />
      {series.isPending && <FlightSkeleton kind="replay" />}
      {data && hasPath && <FlightReplay series={data} scalars={result.scalars} />}
      {notFound && (
        <p className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-ink-2">
          {t("flight.noSeries")}
        </p>
      )}
      {failed && <Callout tone="error">{message}</Callout>}
      <KpiCards scalars={result.scalars} series={data ?? null} />
      {series.isPending && <FlightSkeleton kind="chart" />}
      {data && <SeriesPanel series={data} />}
      <FlightTimeline scalars={result.scalars} />
      {series.isError && <PlotGallery urls={result.plot_urls} />}
    </>
  );
}
