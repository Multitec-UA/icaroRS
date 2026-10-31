"use client";

/**
 * ResultsColumn — the Workbench's right column (S7/S8).
 *
 * What it shows depends on the import state and the active export:
 *   - no export, nothing importing (A1): the `.ork` drop zone and, when the
 *     org has rockets, "Or pick one already converted";
 *   - a file picked and waiting for its destination: the DestinationCard;
 *   - converting / failed (A2): the ImportStatusCard, honest about progress;
 *   - an export active before the first run: the RocketSummaryCard (S3),
 *     what the file says about the rocket, "Ready to run";
 *   - a file importing with no export yet: the quiet placeholder;
 *   - after a run: the displayed run (S6) through RunResults (S7), the
 *     same composition the run report renders;
 *   - while the URL resolves (S8): a skeleton; when its run or file is gone
 *     (404): "This run's file is no longer available" / "This file is no
 *     longer available" with "Start fresh", never a blank column.
 *
 * Errors the input sections could not place next to a field (general 422
 * messages, 503 hints, network failures) are shown here, above the results.
 */

import { useMemo } from "react";
import type { FieldError } from "@/lib/api";
import { cn } from "@/lib/styles";
import { rocketSummaryFromManifest } from "@/lib/domain/rocket";
import { useWizardDraft, type DisplayedRun } from "@/components/wizard/WizardProvider";
import { useRocketsQuery, useSeriesQuery } from "@/lib/queries";
import { Button, Callout } from "@/components/ui";
import { ResultsSkeleton } from "@/components/results/ResultsSkeleton";
import { FadeSwap } from "@/components/motion";
import { ReplayProvider } from "@/components/flight/ReplayContext";
import { RunResults } from "@/components/results/RunResults";
import { useT } from "@/components/i18n/LocaleProvider";
import { unplacedErrors } from "./fieldErrors";
import { InfoIcon } from "./icons";
import { ImportDropZone } from "./ImportDropZone";
import { RocketPicker } from "./RocketPicker";
import { DestinationCard } from "./DestinationCard";
import { ImportStatusCard } from "./ImportStatusCard";
import { RocketSummaryCard } from "./RocketSummaryCard";
import type { OrkImport } from "./useOrkImport";
import type { WorkbenchUrl } from "./useWorkbenchUrl";

export function ResultsColumn({
  id,
  hidden = false,
  errors,
  fatal,
  importer,
  url,
}: {
  /** Phone tab state (S10): hides the column below lg only, never unmounting it. */
  id?: string;
  hidden?: boolean;
  errors: FieldError[];
  fatal: string | null;
  importer: OrkImport;
  url: WorkbenchUrl;
}) {
  const t = useT();
  const { state } = useWizardDraft();
  const rockets = useRocketsQuery();
  const displayedRun = state.displayedRun;
  const general = unplacedErrors(errors);
  const { phase } = importer;
  const hasExport = state.exportId !== null;
  const summary = useMemo(() => rocketSummaryFromManifest(state.manifest), [state.manifest]);
  const urlStatus = url.status;
  const urlProblem = urlStatus.kind === "missing" || urlStatus.kind === "failed";

  return (
    <section
      id={id}
      aria-label={t("workbench.results")}
      className={cn("flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-5", hidden && "max-lg:hidden")}
    >
      {fatal && <Callout tone="error">{fatal}</Callout>}
      {general.length > 0 && (
        <Callout tone="error" title={t("workbench.errorsTitle")}>
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

      {urlStatus.kind === "loading" ? (
        <ResultsSkeleton label={t("workbench.loadingUrl")} />
      ) : urlProblem && phase.kind === "idle" ? (
        <UrlProblem status={urlStatus} onStartFresh={url.startFresh} />
      ) : displayedRun ? (
        <FadeSwap key={displayedRun.runId} className="flex flex-col gap-4">
          <ReplayProvider>
            <DisplayedRunResults run={displayedRun} />
          </ReplayProvider>
        </FadeSwap>
      ) : hasExport ? (
        <RocketSummaryCard summary={summary} name={state.rocketName} file={state.exportFilename} />
      ) : phase.kind !== "idle" ? (
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
 * The displayed run through the shared composition. Lives below
 * ResultsColumn so the series query only exists once there is a run to
 * fetch for (hooks cannot be conditional). The OpenRocket row reads the
 * manifest of the file the run simulated, kept with the run, not the file
 * active now.
 */
function DisplayedRunResults({ run }: { run: DisplayedRun }) {
  const series = useSeriesQuery(run.runId);
  const exportSummary = useMemo(
    () => (run.manifest ? rocketSummaryFromManifest(run.manifest) : null),
    [run.manifest],
  );
  return <RunResults runId={run.runId} result={run.result} exportSummary={exportSummary} series={series} />;
}

/**
 * The Workbench URL names a run or file the API no longer has (404), or
 * could not be resolved at all: say which, and offer to start fresh.
 */
function UrlProblem({
  status,
  onStartFresh,
}: {
  status: Extract<WorkbenchUrl["status"], { kind: "missing" | "failed" }>;
  onStartFresh: () => void;
}) {
  const t = useT();
  const message =
    status.kind === "failed"
      ? t("workbench.loadFailed")
      : status.target === "run"
        ? t("workbench.runMissing")
        : t("workbench.fileMissing");
  const detail =
    status.kind === "failed" && status.error
      ? (status.error.hint ?? t(`errors.${status.error.code}`, { status: status.error.status }))
      : null;
  return (
    <div className="flex flex-col items-start gap-3">
      <Callout tone="warning" title={message} className="self-stretch">
        {detail}
      </Callout>
      <Button variant="ghost" onClick={onStartFresh}>
        {t("workbench.startFresh")}
      </Button>
    </div>
  );
}
