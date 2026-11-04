"use client";

/**
 * PlotCard — one static plot PNG, with a fallback if it fails to load
 * (issue #52). A client island: the `failed` toggle needs `useState`.
 * Extracted out of ResultsDashboard.tsx so the server-rendered plot gallery
 * can drop this in per plot.
 *
 * Plot PNGs sit behind the Identity Platform session cookie, which the
 * browser attaches automatically to same-origin requests — including a
 * bare <img src>, so no manual authenticated fetch is needed.
 */

import { useState } from "react";
import { Reveal } from "@/components/motion";

export function PlotCard({
  url,
  title,
  failedLabel,
  index = 0,
}: {
  url: string;
  title: string;
  failedLabel: string;
  index?: number;
}) {
  const [failed, setFailed] = useState(false);

  return (
    // Stagger is capped so a long gallery doesn't keep the last plots waiting.
    <Reveal delay={Math.min(index, 10) * 0.05}>
      {/* Pinned to the light palette (S7): matplotlib draws on white, so a
          light frame keeps the PNG from glaring as a slab in the dark theme. */}
      <figure className="palette-light overflow-hidden rounded-[14px] border border-border bg-surface text-ink shadow-soft">
        <figcaption className="truncate border-b border-divider px-4 py-2.5 text-sm font-medium text-ink">
          {title}
        </figcaption>
        <div className="flex min-h-48 items-center justify-center bg-surface p-2">
          {failed ? (
            <span className="py-12 text-sm text-muted">{failedLabel}</span>
          ) : (
            // The session cookie is same-origin, so the browser attaches it here too.
            // The plots are 4:3 PNGs; the intrinsic size reserves the box
            // before the (lazy, below-the-fold) image arrives, so the
            // gallery doesn't shift as each one loads.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={title}
              width={1200}
              height={900}
              loading="lazy"
              decoding="async"
              className="h-auto w-full rounded-lg"
              onError={() => setFailed(true)}
            />
          )}
        </div>
      </figure>
    </Reveal>
  );
}
