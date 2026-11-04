import type { ReactNode } from "react";
import { cn } from "@/lib/styles";
import { toneClass, type Tone } from "./classes";
import { Spinner } from "./Spinner";

/**
 * StatusPill — a short state ("Up to date", "Changed since run 12") on the
 * tone tokens. It is a polite live region, so a state change is announced;
 * the optional spinner is decorative because the text already says it.
 *
 * `collapse` (S10) shrinks the pill to its dot (or spinner) below `md`: the
 * text stays in the accessibility tree (`sr-only`) and in `title` /
 * `aria-label`, which default to the text when it is a plain string.
 */
export function StatusPill({
  tone = "neutral",
  spinner = false,
  dot = !spinner,
  collapse = false,
  title,
  className,
  children,
}: {
  tone?: Tone;
  spinner?: boolean;
  dot?: boolean;
  collapse?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const fullText = title ?? (typeof children === "string" ? children : undefined);
  return (
    <span
      role="status"
      title={collapse ? fullText : title}
      aria-label={collapse ? fullText : undefined}
      className={cn(
        "inline-flex h-7 max-w-full items-center gap-[7px] whitespace-nowrap rounded-full px-[11px] text-[13px] font-medium",
        collapse && "max-md:w-7 max-md:justify-center max-md:px-0",
        toneClass[tone],
        className,
      )}
    >
      {spinner && <Spinner decorative className="h-3 w-3 border-[1.5px]" />}
      {dot && <span data-pill-dot aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full bg-current" />}
      <span className={cn("truncate", collapse && "max-md:sr-only")}>{children}</span>
    </span>
  );
}
