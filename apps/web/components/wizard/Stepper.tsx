"use client";

/** Horizontal step indicator for the wizard. Reflects (and allows jumping to
 * already-reached) steps from WizardProvider. */

import { useWizard, STEP_ORDER, type WizardStep } from "./WizardProvider";
import { cn } from "@/components/ui";

const LABELS: Record<WizardStep, string> = {
  rocket: "Rocket",
  basics: "Launch site & time",
  advanced: "Fine-tuning",
  review: "Review",
  results: "Results",
};

// Steps shown in the wizard shell (results is its own page).
const VISIBLE: WizardStep[] = ["rocket", "basics", "advanced", "review"];

export function Stepper() {
  const { step, goto, state } = useWizard();
  const currentIndex = STEP_ORDER.indexOf(step);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      {VISIBLE.map((s, i) => {
        const idx = STEP_ORDER.indexOf(s);
        const isCurrent = s === step;
        const isDone = idx < currentIndex;
        // Allow jumping back to any reached step; never skip ahead.
        const reachable = idx <= currentIndex && state.exportId !== null;
        return (
          <li key={s} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!reachable || isCurrent}
              onClick={() => goto(s)}
              className={cn(
                "flex items-center gap-2 rounded-full px-3 py-1.5 font-medium transition-all duration-500 ease-[var(--ease-spring)]",
                isCurrent &&
                  "bg-white/[0.06] text-foreground ring-1 ring-inset ring-white/15 shadow-[0_0_24px_-8px_rgba(34,211,238,0.5)]",
                isDone && "text-cyan-300/80 hover:bg-white/[0.04]",
                !isCurrent && !isDone && "text-white/30",
                reachable && !isCurrent && "cursor-pointer",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[11px] ring-1 transition-all duration-500 ease-[var(--ease-spring)]",
                  isCurrent && "ring-cyan-400/60 text-cyan-300",
                  isDone && "bg-cyan-400/90 text-[#050505] ring-transparent",
                  !isCurrent && !isDone && "ring-white/15",
                )}
              >
                {isDone ? "✓" : i + 1}
              </span>
              {LABELS[s]}
            </button>
            {i < VISIBLE.length - 1 && <span className="text-white/15">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
