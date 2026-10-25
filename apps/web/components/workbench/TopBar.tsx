"use client";

/**
 * TopBar — the Workbench's command row (S7/S8): the rocket context button
 * (`{rocket} · {file}`, "No rocket selected", or `{file} converting…` while
 * a `.ork` converts), the status pill, and the primary Run button with its
 * ⌘↵ hint.
 *
 * Status pill contract:
 *   - nothing before the first run;
 *   - "Up to date · run {id}" while the results on screen come from the
 *     active export;
 *   - "Results are from {filename} · run {id}" once the active export changed
 *     after the last run, so stale numbers never pass for current ones — the
 *     Run button then reads "Run this file".
 *
 * The rocket button opens the RocketPanel dialog (S8/A3) once a rocket is
 * active; while nothing is selected, or a file is converting, it only shows
 * the context. While the panel is open the header sits above a scrim.
 */

import { useCallback, useId, useRef, useState } from "react";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Spinner } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { ChevronDownIcon, PlayIcon } from "./icons";
import { RocketPanel } from "./RocketPanel";
import { primaryButton } from "./styles";
import type { RunSimulation } from "./useRunSimulation";
import type { OrkImport } from "./useOrkImport";

export function TopBar({ simulation, importer }: { simulation: RunSimulation; importer: OrkImport }) {
  const t = useT();
  const { state } = useWizardDraft();
  const { run, ready, busy, stale } = simulation;
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
      ? t("workbench.noRocket")
      : state.rocketName
        ? t("workbench.rocketContext", { rocket: state.rocketName, file })
        : file;

  const runId = state.runId ?? "";
  const staleFile = state.resultExportFilename ?? state.resultExportId ?? "";

  // The panel needs a rocket to show; it is also left closed while a file
  // converts, since the context button then describes the conversion.
  const rocketId = state.rocketId;
  const canOpen = rocketId !== null && !converting;
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

      {panelOpen && rocketId !== null && (
        <RocketPanel
          id={panelId}
          rocketId={rocketId}
          anchorRef={triggerRef}
          importer={importer}
          onClose={closePanel}
        />
      )}

      {/* Always mounted so the pill's appearance and wording changes are announced. */}
      <div aria-live="polite" className="min-w-0">
        {state.result !== null && (
          <span
            className={cn(
              "inline-flex h-[26px] max-w-full items-center gap-1.5 rounded-full px-2.5 text-xs font-medium",
              stale ? "bg-warn-soft text-warn-ink" : "bg-ok-soft text-ok-ink",
            )}
          >
            <span
              aria-hidden
              className={cn("h-1.5 w-1.5 shrink-0 rounded-full", stale ? "bg-warn" : "bg-ok motion-safe:animate-pulse")}
            />
            <span className="truncate">
              {stale
                ? t("workbench.statusStale", { filename: staleFile, runId })
                : t("workbench.statusUpToDate", { runId })}
            </span>
          </span>
        )}
      </div>

      <div className="flex-1" />

      <span aria-live="polite" className="sr-only">
        {busy && t("review.running")}
      </span>
      <button type="button" onClick={() => void run()} disabled={!ready} className={primaryButton}>
        {busy ? <Spinner decorative className="h-3.5 w-3.5" /> : <PlayIcon />}
        {busy ? t("workbench.running") : stale ? t("workbench.runThisFile") : t("workbench.run")}
        <kbd aria-hidden className="font-mono text-[11px] opacity-75">
          ⌘↵
        </kbd>
        <span className="sr-only">{t("workbench.runShortcut")}</span>
      </button>
    </header>
  );
}
