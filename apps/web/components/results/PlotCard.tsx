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
import { Surface } from "@/components/ui";
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
    <Reveal delay={index * 0.05}>
      <Surface as="div" innerClassName="overflow-hidden">
        <figure>
          <figcaption className="border-b border-white/[0.06] px-4 py-2.5 text-sm font-medium text-foreground/90">
            {title}
          </figcaption>
          <div className="flex min-h-48 items-center justify-center bg-white p-2">
            {failed ? (
              <span className="py-12 text-sm text-slate-400">{failedLabel}</span>
            ) : (
              // The session cookie is same-origin, so the browser attaches it here too.
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={title} className="w-full rounded-lg" onError={() => setFailed(true)} />
            )}
          </div>
        </figure>
      </Surface>
    </Reveal>
  );
}
