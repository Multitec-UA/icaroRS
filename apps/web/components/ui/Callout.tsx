import type { ReactNode } from "react";
import { cn } from "@/lib/styles";

/** Callout tones map onto the kit's soft fill + ink tokens. */
const TONES = {
  info: "bg-accent-soft text-accent-ink",
  warning: "bg-warn-soft text-warn-ink",
  error: "bg-bad-soft text-bad-ink",
  success: "bg-ok-soft text-ok-ink",
} as const;

/**
 * Callout — info / warning / error / success banner. Callouts carry async
 * outcomes (validation, fetch failures, confirmations), so they are live
 * regions: errors interrupt, the rest wait politely.
 */
export function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("break-words rounded-[11px] px-4 py-3 text-sm", TONES[tone], className)}
    >
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && "mt-1 text-[0.92em] opacity-90")}>{children}</div>}
    </div>
  );
}
