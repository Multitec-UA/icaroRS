"use client";

import { cn, focusRing } from "@/lib/styles";

/**
 * SegmentedControl — one-of-N chooser rendered as a chip track (atmosphere
 * model, replay speed). Plain buttons with `aria-pressed` inside a labelled
 * group: tabbable, no roving-focus machinery needed, and `value: null` means
 * "none pressed" (e.g. a customized preset).
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex gap-0.5 rounded-[11px] bg-chip p-[3px]", className)}>
      {options.map((option) => {
        const pressed = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-[30px] min-w-0 flex-1 truncate rounded-lg px-2 text-sm transition-[background-color,color,box-shadow] duration-300 ease-[var(--ease-spring)] pointer-coarse:min-h-11",
              focusRing,
              pressed ? "bg-surface font-medium text-ink shadow-soft" : "text-ink-2 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
