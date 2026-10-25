"use client";

/**
 * FlightSkeleton — placeholders for the replay and the series card while the
 * flight series loads (S9). Token-coloured blocks with a pulse that stops
 * under prefers-reduced-motion (`motion-safe:`). The replay block is the one
 * live region ("Loading flight data…"); the chart block is decorative so the
 * state is announced once.
 */

import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";

const BLOCK = "rounded-xl bg-chip motion-safe:animate-pulse";

export function FlightSkeleton({ kind }: { kind: "replay" | "chart" }) {
  const t = useT();
  const a11y =
    kind === "replay"
      ? ({ role: "status", "aria-live": "polite", "aria-label": t("flight.loadingSeries") } as const)
      : ({ "aria-hidden": true } as const);

  return (
    <div
      {...a11y}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-soft"
    >
      <div className="flex items-center justify-between">
        <span className={cn(BLOCK, "h-4 w-28")} />
        <span className={cn(BLOCK, "h-6 w-40 rounded-full")} />
      </div>
      <div className={cn(BLOCK, kind === "replay" ? "h-[300px]" : "h-[320px]")} />
      {kind === "replay" && (
        <div className="flex items-center gap-3">
          <span className={cn(BLOCK, "h-9 w-9 rounded-full")} />
          <span className={cn(BLOCK, "h-1.5 flex-1 rounded-full")} />
          <span className={cn(BLOCK, "h-6 w-20 rounded-full")} />
        </div>
      )}
    </div>
  );
}
