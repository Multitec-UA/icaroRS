import type { ReactNode } from "react";
import { cn } from "@/lib/styles";
import { toneClass, type Tone } from "./classes";
import { Spinner } from "./Spinner";

/**
 * StatusPill — a short state ("Up to date", "Changed since run 12") on the
 * tone tokens. It is a polite live region, so a state change is announced;
 * the optional spinner is decorative because the text already says it.
 */
export function StatusPill({
  tone = "neutral",
  spinner = false,
  dot = !spinner,
  className,
  children,
}: {
  tone?: Tone;
  spinner?: boolean;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      role="status"
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-[7px] whitespace-nowrap rounded-full px-[11px] text-[13px] font-medium",
        toneClass[tone],
        className,
      )}
    >
      {spinner && <Spinner decorative className="h-3 w-3 border-[1.5px]" />}
      {dot && <span data-pill-dot aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" />}
      <span className="truncate">{children}</span>
    </span>
  );
}
