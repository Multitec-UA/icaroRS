"use client";

/**
 * TopBar — the Workbench's command row (S7): the rocket context button
 * (`{rocket} · {file}`, or "No rocket selected"), the status pill, and the
 * primary Run button with its ⌘↵ hint.
 *
 * Status pill contract:
 *   - nothing before the first run;
 *   - "Up to date · run {id}" while the results on screen come from the
 *     active export;
 *   - "Results are from {filename} · run {id}" once the active export changed
 *     after the last run, so stale numbers never pass for current ones.
 *
 * The rocket button is a placeholder until T7 wires the rocket panel to it:
 * it already shows the active context but is disabled.
 */

import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Spinner } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { ChevronDownIcon, PlayIcon } from "./icons";
import type { RunSimulation } from "./useRunSimulation";

export function TopBar({ simulation }: { simulation: RunSimulation }) {
  const t = useT();
  const { state } = useWizardDraft();
  const { run, ready, busy } = simulation;

  const hasExport = state.exportId !== null;
  const file = state.exportFilename ?? state.exportId ?? "";
  const contextLabel = !hasExport
    ? t("workbench.noRocket")
    : state.rocketName
      ? t("workbench.rocketContext", { rocket: state.rocketName, file })
      : file;

  const stale = state.result !== null && state.resultExportId !== state.exportId;
  const runId = state.runId ?? "";
  const staleFile = state.resultExportFilename ?? state.resultExportId ?? "";

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 sm:px-5">
      <button
        type="button"
        disabled
        title={t("workbench.rocketContextLabel")}
        className="flex h-9 min-w-0 max-w-full items-center gap-2 rounded-[9px] border border-border bg-surface px-3 text-sm text-ink"
      >
        <span
          aria-hidden
          className={cn("h-2 w-2 shrink-0 rounded-full", hasExport ? "bg-accent" : "bg-chip")}
        />
        <span className="truncate">{contextLabel}</span>
        <ChevronDownIcon className="shrink-0 text-muted" />
      </button>

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
      <button
        type="button"
        onClick={() => void run()}
        disabled={!ready}
        className={cn(
          "flex h-9 items-center gap-2 rounded-[9px] bg-primary px-3.5 text-sm font-medium text-on-primary transition-[opacity,transform,box-shadow] duration-300 ease-[var(--ease-spring)] hover:shadow-soft active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
          focusRing,
        )}
      >
        {busy ? <Spinner decorative className="h-3.5 w-3.5" /> : <PlayIcon />}
        {busy ? t("workbench.running") : t("workbench.run")}
        <kbd aria-hidden className="font-mono text-[11px] opacity-75">
          ⌘↵
        </kbd>
        <span className="sr-only">{t("workbench.runShortcut")}</span>
      </button>
    </header>
  );
}
