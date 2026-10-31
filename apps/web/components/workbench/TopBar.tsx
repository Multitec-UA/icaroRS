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
 * disabled only while a run is in flight or the draft cannot run.
 *
 * The rocket button opens the RocketPanel dialog (S8/A3, S9) whenever a file
 * is active — including a file that predates rockets (`rocketId` null), for
 * which the panel shows the file alone with an import drop zone. While no
 * file is loaded, or a file is converting, it only shows the context. While
 * the Workbench URL resolves (S8) it reads "Opening…". While the panel is
 * open the header sits above a scrim.
 */

import { useCallback, useId, useRef, useState } from "react";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Spinner, StatusPill } from "@/components/ui";
import { ChangeChip } from "@/components/runs/WhatChanged";
import type { ChangeGroup } from "@/lib/domain/runs";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { ChevronDownIcon, PlayIcon } from "./icons";
import { RocketPanel } from "./RocketPanel";
import { primaryButton } from "./styles";
import type { RunSimulation } from "./useRunSimulation";
import type { OrkImport } from "./useOrkImport";
import type { WorkbenchUrl } from "./useWorkbenchUrl";

const GROUP_LABEL = {
  file: "runs.groupFile",
  site: "runs.groupSite",
  date: "runs.groupDate",
  weather: "runs.groupWeather",
  rail: "runs.groupRail",
} as const satisfies Record<ChangeGroup, string>;

export function TopBar({
  simulation,
  importer,
  url,
}: {
  simulation: RunSimulation;
  importer: OrkImport;
  url: WorkbenchUrl;
}) {
  const t = useT();
  const { state } = useWizardDraft();
  const { run, ready, busy, status, hasRun } = simulation;
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const { phase } = importer;
  const converting = phase.kind === "converting";
  const hasExport = state.exportId !== null;
  const file = state.exportFilename ?? state.exportId ?? "";
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
        "relative flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 sm:px-5",
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
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {status.kind === "none" && <StatusPill>{t("workbench.statusNone")}</StatusPill>}
        {status.kind === "running" && <StatusPill spinner>{t("workbench.statusRunning")}</StatusPill>}
        {status.kind === "upToDate" && (
          <StatusPill tone="ok">{t("workbench.statusUpToDate", { runId: status.runId })}</StatusPill>
        )}
        {status.kind === "changed" && (
          <>
            <StatusPill tone="warn">{t("workbench.statusChanged", { runId: status.runId })}</StatusPill>
            <ul aria-label={t("workbench.changesLabel")} className="flex flex-wrap gap-1.5">
              {status.changes.map((group) => (
                <ChangeChip key={group} tone="warn">
                  {t(GROUP_LABEL[group])}
                </ChangeChip>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="flex-1" />

      <button type="button" onClick={() => void run()} disabled={!ready}
        // A disabled Run stays readable (opacity 60 %, not the kit's 50 %; `!` wins over it).
        className={cn(primaryButton, "disabled:text-on-primary disabled:opacity-60!")}
      >
        {busy ? <Spinner decorative className="h-3.5 w-3.5" /> : <PlayIcon />}
        {busy ? t("workbench.running") : hasRun ? t("workbench.runAgain") : t("workbench.run")}
        <kbd aria-hidden className="font-mono text-[11px] opacity-75">
          ⌘↵
        </kbd>
        <span className="sr-only">{t("workbench.runShortcut")}</span>
      </button>
    </header>
  );
}
