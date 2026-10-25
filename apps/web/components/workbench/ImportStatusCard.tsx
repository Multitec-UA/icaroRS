"use client";

/**
 * ImportStatusCard — the conversion in flight, or its failure (S8/A2, L14).
 *
 * The API reports no progress, so this card is honest about it: an
 * indeterminate bar (static under prefers-reduced-motion) and the four
 * server steps listed as an explanation of what takes the time — never as
 * checkmarks ticking on a timer. On failure the message is shown inline with
 * a "Try another file" action; a Java-related hint is a warning about the
 * server, not about the user's file.
 */

import { motion, useReducedMotion } from "motion/react";
import { useT } from "@/components/i18n/LocaleProvider";
import { Spinner } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { cn } from "@/lib/styles";
import type { ImportPhase } from "./useOrkImport";
import { ghostButton } from "./styles";

const STEP_KEYS = [
  "workbench.stepUploaded",
  "workbench.stepOpened",
  "workbench.stepExporting",
  "workbench.stepBuilding",
] as const;

export function ImportStatusCard({
  phase,
  onRetry,
}: {
  phase: Extract<ImportPhase, { kind: "converting" | "failed" }>;
  onRetry: () => void;
}) {
  const t = useT();
  const reduce = useReducedMotion();

  if (phase.kind === "failed") {
    const warning = phase.tone === "warning";
    return (
      <Reveal>
        <section
          role="alert"
          className={cn(
            "flex flex-col gap-3 rounded-2xl px-4 py-4 text-sm",
            warning ? "bg-warn-soft text-warn-ink" : "bg-bad-soft text-bad-ink",
          )}
        >
          <p className="font-semibold">
            {t("workbench.convertFailedTitle", { filename: phase.file.name })}
          </p>
          <p className="break-words">{phase.message}</p>
          <div>
            <button type="button" onClick={onRetry} className={ghostButton}>
              {t("workbench.tryAnotherFile")}
            </button>
          </div>
        </section>
      </Reveal>
    );
  }

  return (
    <Reveal>
      <section
        aria-live="polite"
        className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-soft sm:p-5"
      >
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"
          >
            <Spinner decorative className="h-4 w-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="break-words text-sm font-semibold text-ink">
              {t("workbench.convertingTitle", { filename: phase.file.name })}
            </p>
            <p className="text-xs text-ink-2">{t("workbench.convertingHint")}</p>
          </div>
        </div>

        {/* Indeterminate: no aria-valuenow, because the server reports none. */}
        <div
          role="progressbar"
          aria-label={t("workbench.convertingProgress")}
          className="h-1.5 w-full overflow-hidden rounded-full bg-chip"
        >
          {reduce ? (
            <span className="block h-full w-2/5 rounded-full bg-accent" />
          ) : (
            <motion.span
              className="block h-full w-2/5 rounded-full bg-accent"
              initial={{ x: "-100%" }}
              animate={{ x: "250%" }}
              transition={{ duration: 1.6, repeat: Infinity, ease: [0.45, 0, 0.55, 1] }}
            />
          )}
        </div>

        <ol aria-label={t("workbench.convertingStepsLabel")} className="grid gap-1.5 text-xs text-ink-2 sm:grid-cols-2">
          {STEP_KEYS.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-axis" />
              {t(key)}
            </li>
          ))}
        </ol>
      </section>
    </Reveal>
  );
}
