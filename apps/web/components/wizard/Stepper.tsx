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
                "flex items-center gap-2 rounded-full px-3 py-1.5 font-medium transition-colors",
                isCurrent && "bg-sky-600 text-white",
                isDone && "text-sky-700 hover:bg-sky-50",
                !isCurrent && !isDone && "text-slate-400",
                reachable && !isCurrent && "cursor-pointer",
              )}
            >
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full border text-xs",
                  isCurrent && "border-white",
                  isDone && "border-sky-600 bg-sky-600 text-white",
                  !isCurrent && !isDone && "border-slate-300",
                )}
              >
                {isDone ? "✓" : i + 1}
              </span>
              {LABELS[s]}
            </button>
            {i < VISIBLE.length - 1 && <span className="text-slate-300">→</span>}
          </li>
        );
      })}
    </ol>
  );
}
