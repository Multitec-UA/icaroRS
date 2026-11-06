"use client";

/**
 * TopBar — the Workbench's command row (S7/S8): the rocket context button
 * (`{rocket} · {file}`, "No rocket selected", or `{file} converting…` while
 * a `.ork` converts), the status pill, and the primary Run button with its
 * ⌘↵ hint.
 *
 * Status pill contract (S6, from `simulation.status`): "No run yet",
 * "Running…" with a spinner, "Up to date · run {id}", or "Changed since run
 * {id}" followed by one chip per changed group (File, Site, Date, Weather,
 * Rail) — the /runs "what changed" chip. The Run button reads "Run
 * simulation" before the first run and "Run again" afterwards; it is
 * disabled only while a run is in flight or the draft cannot run. Disabled,
 * it says why (S12f) in its `title` and a helper line under it, one reason
 * at a time: "Pick a launch site first", "Pick a launch date first" or
 * "Running…" (`runBlocker`; no reason while no file is loaded).
 *
 * The rocket button opens the RocketPanel dialog (S8/A3, S9) whenever a file
 * is active — including a file that predates rockets (`rocketId` null), for
 * which the panel shows the file alone with an import drop zone. While no
 * file is loaded, or a file is converting, it only shows the context. While
 * the Workbench URL resolves (S8) it reads "Opening…". While the panel is
 * open the header sits above a scrim.
 *
 * "Dispersion" (S12) sits left of Run whenever a file is loaded and not
 * converting: its panel queues a Monte Carlo run (MonteCarloLauncher). It
 * has its own state; Run never waits on it.
 *
 * Below `md` (S10) the row never wraps: the context label truncates, the
 * pill collapses to its dot (full text, with the changed groups, in its
 * `title` / accessible name), the change chips and the ⌘↵ hint are hidden.
 */

import { useCallback, useId, useRef, useState } from "react";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Spinner, StatusPill } from "@/components/ui";
import { CHANGE_GROUP_LABEL, ChangeChip } from "@/components/runs/WhatChanged";
import { runBlocker } from "@/lib/domain/scenario";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { ChevronDownIcon, PlayIcon } from "./icons";
import { RocketPanel } from "./RocketPanel";
import { MonteCarloLauncher } from "./MonteCarloLauncher";
import type { MonteCarloControl } from "./useMonteCarlo";
import { primaryButton } from "./styles";
import type { RunSimulation } from "./useRunSimulation";
import type { OrkImport } from "./useOrkImport";
import type { WorkbenchUrl } from "./useWorkbenchUrl";
import { fileLabel } from "@/lib/domain/exports";


export function TopBar({
  simulation,
  importer,
  url,
  monteCarlo,
}: {
  simulation: RunSimulation;
  importer: OrkImport;
  url: WorkbenchUrl;
  monteCarlo: MonteCarloControl;
}) {
  const t = useT();
  const { state } = useWizardDraft();
  const { run, ready, busy, status, hasRun } = simulation;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const blocker = runBlocker(state);
  // While running, the button ("Simulating…") and the status pill already say
  // so; a third line under the button only misaligns the row (user, 2026-11-06).
  const runReason = busy
    ? null
    : ready
      ? null
      : blocker === "site"
        ? t("workbench.runNeedsSite")
        : blocker === "date"
          ? t("workbench.runNeedsDate")
          : null;

  const { phase } = importer;
  const converting = phase.kind === "converting";
  const hasExport = state.exportId !== null;
  const file = fileLabel(state.exportFilename, state.exportRevision, state.exportId ?? "");
  const contextLabel =
    phase.kind === "converting"
      ? t("workbench.convertingContext", { filename: phase.file.name })
      : !hasExport
        ? url.status.kind === "loading"
          ? t("workbench.loadingUrl")
          : t("workbench.noRocket")
        : state.rocketName
          ? t("workbench.rocketContext", { rocket: state.rocketName, file })
          : file;

  // The panel needs an active file (a rocket-less one included, S9); it is
  // left closed while a file converts, since the context button then
  // describes the conversion.
  const rocketId = state.rocketId;
  const canOpen = hasExport && !converting;
  const panelOpen = open && canOpen;

  const closePanel = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  return (
    <header
      className={cn(
        "relative flex items-center gap-3 border-b border-divider px-4 py-3 sm:px-5 md:flex-wrap",
        panelOpen && "z-40",
      )}
    >
      {panelOpen && <div aria-hidden className="fixed inset-0 -z-10 bg-[var(--scrim)]" />}

      <button
        ref={triggerRef}
        type="button"
        disabled={!canOpen}
        aria-expanded={panelOpen}
        aria-haspopup="dialog"
        aria-controls={panelOpen ? panelId : undefined}
        title={t("workbench.rocketContextLabel")}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex h-9 min-w-0 max-w-full items-center gap-2 rounded-[9px] border border-border bg-surface px-3 text-sm text-ink transition-[background-color,border-color] duration-300 ease-[var(--ease-spring)] enabled:hover:bg-surface-2 disabled:cursor-default",
          focusRing,
        )}
      >
        {converting ? (
          <Spinner decorative className="h-3 w-3 shrink-0 text-accent-ink" />
        ) : (
          <span
            aria-hidden
            className={cn("h-2 w-2 shrink-0 rounded-full", hasExport ? "bg-accent" : "bg-chip")}
          />
        )}
        <span className={cn("truncate", converting && "font-mono text-[13px]")}>{contextLabel}</span>
        <ChevronDownIcon
          className={cn(
            "shrink-0 text-muted transition-transform duration-300 ease-[var(--ease-spring)]",
            panelOpen && "rotate-180",
          )}
        />
      </button>

      {panelOpen && (
        <RocketPanel
          id={panelId}
          rocketId={rocketId}
          anchorRef={triggerRef}
          importer={importer}
          onClose={closePanel}
        />
      )}

      {/* StatusPill is a polite live region: every state change is announced. */}
      <div className="flex shrink-0 items-center gap-1.5 md:min-w-0 md:shrink md:flex-wrap">
        {status.kind === "none" && <StatusPill collapse>{t("workbench.statusNone")}</StatusPill>}
        {status.kind === "running" && (
          <StatusPill collapse spinner>
            {t("workbench.statusRunning")}
          </StatusPill>
        )}
        {status.kind === "upToDate" && (
          <StatusPill collapse tone="ok">
            {t("workbench.statusUpToDate", { runId: status.runId })}
          </StatusPill>
        )}
        {status.kind === "changed" && (
          <>
            <StatusPill
              collapse
              tone="warn"
              title={[
                t("workbench.statusChanged", { runId: status.runId }),
                status.changes.map((group) => t(CHANGE_GROUP_LABEL[group])).join(", "),
              ].join(" · ")}
            >
              {t("workbench.statusChanged", { runId: status.runId })}
            </StatusPill>
            <ul aria-label={t("workbench.changesLabel")} className="flex flex-wrap gap-1.5 max-md:hidden">
              {status.changes.map((group) => (
                <ChangeChip key={group} tone="warn">
                  {t(CHANGE_GROUP_LABEL[group])}
                </ChangeChip>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="min-w-0 flex-1" />

      {canOpen && (
        <MonteCarloLauncher
          disabledReason={monteCarlo.disabledReason}
          submitting={monteCarlo.submitting}
          error={monteCarlo.submitError}
          onLaunch={monteCarlo.launch}
        />
      )}

      <div className="flex shrink-0 flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => void run()}
          disabled={!ready}
          title={runReason ?? undefined}
          aria-describedby={runReason ? "run-reason" : undefined}
          // A disabled Run stays readable (opacity 60 %, not the kit's 50 %; `!` wins over it).
          className={cn(primaryButton, "shrink-0 disabled:text-on-primary disabled:opacity-60!")}
        >
          {busy ? <Spinner decorative className="h-3.5 w-3.5" /> : <PlayIcon />}
          {busy ? t("workbench.running") : hasRun ? t("workbench.runAgain") : t("workbench.run")}
          <kbd aria-hidden className="font-mono text-[11px] opacity-75 max-md:hidden">
            ⌘↵
          </kbd>
          <span className="sr-only">{t("workbench.runShortcut")}</span>
        </button>
        {runReason && (
          <span id="run-reason" className="text-xs text-muted">
            {runReason}
          </span>
        )}
      </div>
    </header>
  );
}
