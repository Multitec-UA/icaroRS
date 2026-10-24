"use client";

/**
 * InfoTip — a glossary "i" badge that opens a definition on click/tap.
 *
 * A toggletip, not a native tooltip: `title` only appears after the browser's
 * hover delay, never on touch, never on keyboard focus, and cannot be styled.
 * Here the definition shows immediately on activation in the app's own glass
 * popover, is announced through a live region, and closes on a second click,
 * Escape (focus returns to the badge), a press outside, scroll or resize.
 *
 * The popover is portalled to <body> with fixed positioning: the cards it sits
 * in are animated with transforms, which create stacking contexts that would
 * otherwise let the next card paint over it. Its position is measured in the
 * click handler, never during render.
 */

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";

const POPOVER_WIDTH = 288; // matches max-w-72
const VIEWPORT_GUTTER = 8;
const GAP = 8;
/** Below this much room under the badge, the popover opens above it instead. */
const MIN_ROOM_BELOW = 160;

type Placement = { left: number; top?: number; bottom?: number };

function placeFor(trigger: HTMLElement): Placement {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2);
  const centered = rect.left + rect.width / 2 - width / 2;
  const left = Math.max(VIEWPORT_GUTTER, Math.min(centered, window.innerWidth - width - VIEWPORT_GUTTER));
  return window.innerHeight - rect.bottom >= MIN_ROOM_BELOW
    ? { left, top: rect.bottom + GAP }
    : { left, bottom: window.innerHeight - rect.top + GAP };
}

function InfoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="block">
      <circle cx="8" cy="8" r="7.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M8 7.25v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="8" cy="4.75" r="0.9" fill="currentColor" />
    </svg>
  );
}

export function InfoTip({ term }: { term: string }) {
  const t = useT();
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const open = placement !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPlacement(null);
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      close();
      triggerRef.current?.focus();
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      close();
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    // The popover is fixed: scrolling or resizing would detach it from the badge.
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const key = `glossary.${term}`;
  const def = t(key);
  // If the key is missing (t returns the key itself), render nothing.
  if (def === key) return null;

  function toggle() {
    setPlacement((current) => (current || !triggerRef.current ? null : placeFor(triggerRef.current)));
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("common.moreInfo")}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={toggle}
        className={cn(
          // shrink-0 + fixed box + reset type: the badge often sits in uppercase,
          // letter-spaced flex rows that would otherwise squash or offset it.
          "relative inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-full p-0 leading-none normal-case tracking-normal transition-colors duration-200",
          // Larger invisible hit area for touch without changing the layout.
          "after:absolute after:-inset-2 after:content-['']",
          open ? "text-cyan-300" : "text-white/45 hover:text-white/85",
          focusRing,
        )}
      >
        <InfoIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={popoverId}
            role="status"
            style={{ left: placement.left, top: placement.top, bottom: placement.bottom }}
            className="fixed z-50 w-72 max-w-[calc(100vw-1rem)] rounded-2xl bg-[#0b0b0e]/95 px-4 py-3 text-left text-xs font-normal normal-case leading-relaxed tracking-normal text-foreground/90 shadow-[0_12px_48px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/10 backdrop-blur-md"
          >
            {def}
          </div>,
          document.body,
        )}
    </>
  );
}
