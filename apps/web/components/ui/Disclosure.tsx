"use client";

import { useRef, type KeyboardEvent, type ReactNode, type SyntheticEvent } from "react";
import { cn, focusRing } from "@/lib/styles";
import { cardClass } from "./classes";

/**
 * Disclosure — a native <details> card ("All results (16 values)",
 * "Plots (12)"). Native means zero JS state, the find-in-page reveal and
 * print expansion for free; the summary carries an optional count and a meta
 * slot. Enter / Space are handled explicitly so the toggle behaves the same
 * in every engine (and in jsdom), and `onToggle` reports the new state.
 */
export function Disclosure({
  title,
  count,
  meta,
  defaultOpen = false,
  onToggle,
  className,
  children,
}: {
  title: ReactNode;
  count?: number;
  meta?: ReactNode;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // Set when a keyboard toggle already reported; swallows the matching
  // (async) native `toggle` event so `onToggle` fires once per change.
  const skipNative = useRef(false);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    const details = ref.current;
    if (!details) return;
    details.open = !details.open;
    // jsdom does not fire `toggle` when `open` is set; browsers do, async.
    // Report here and ignore the native event for keyboard toggles.
    onToggle?.(details.open);
    skipNative.current = true;
  }

  function onNativeToggle(event: SyntheticEvent<HTMLDetailsElement>) {
    if (skipNative.current) {
      skipNative.current = false;
      return;
    }
    onToggle?.(event.currentTarget.open);
  }

  return (
    <details
      ref={ref}
      open={defaultOpen || undefined}
      onToggle={onNativeToggle}
      className={cn("group overflow-hidden", cardClass, className)}
    >
      <summary
        onKeyDown={onKeyDown}
        className={cn(
          "flex min-h-12 cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[15px] font-semibold text-ink transition-colors duration-300 hover:bg-surface-2 [&::-webkit-details-marker]:hidden",
          focusRing,
          "focus-visible:ring-offset-0 focus-visible:ring-inset",
        )}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden="true"
          className="shrink-0 text-muted transition-transform duration-300 ease-[var(--ease-spring)] group-open:rotate-90"
        >
          <path d="m5 3 4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 truncate">
          {title}
          {count != null && <span className="font-normal text-muted"> ({count})</span>}
        </span>
        {meta != null && <span className="ml-auto truncate text-[13px] font-normal text-muted">{meta}</span>}
      </summary>
      <div className="border-t border-divider px-4 pb-4 pt-1">{children}</div>
    </details>
  );
}
