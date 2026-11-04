"use client";

/**
 * Tooltip — a short visual label for an icon-only control.
 *
 * Shown on pointer hover AND on keyboard focus (a native `title` never shows
 * on focus or touch, see InfoTip), dismissed by Escape without moving focus
 * (WCAG 1.4.13), and decorative for assistive tech: the control carries the
 * same text as its own `aria-label`, so the tooltip is `aria-hidden` and is
 * never read twice.
 *
 * Positioned above the control; `align="end"` pins its right edge to the
 * control's, for controls at the end of a row.
 */

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "@/lib/styles";

export function Tooltip({
  label,
  align = "center",
  children,
}: {
  label: string;
  align?: "center" | "end";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") setOpen(false);
  }

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onKeyDown={onKeyDown}
    >
      {children}
      {open && (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute bottom-full z-20 mb-1.5 whitespace-nowrap rounded-md bg-ink px-2 py-1 text-xs font-medium text-bg shadow-soft",
            align === "end" ? "right-0" : "left-1/2 -translate-x-1/2",
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
