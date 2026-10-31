import type { ReactNode } from "react";
import { cn } from "@/lib/styles";

/**
 * Kbd — a keyboard hint (⌘↵). On a chip by default; inside a primary button
 * pass `onPrimary` so it reads as an outline in the button's own ink.
 */
export function Kbd({
  children,
  onPrimary = false,
  className,
}: {
  children: ReactNode;
  onPrimary?: boolean;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "rounded-[5px] px-1.5 py-0.5 font-mono text-[11px] font-medium leading-none",
        onPrimary ? "border border-current bg-transparent text-current opacity-85" : "bg-chip text-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
