"use client";

/**
 * Presentational content for a route-level error boundary (app/error.tsx,
 * app/results/[runId]/error.tsx). Deliberately dumb: it takes already-
 * translated strings and callbacks, so it never resolves its own locale or
 * touches a context that might itself be the thing that failed.
 *
 * Kept separate from the boundary file it's rendered from so it can be unit
 * tested directly — Next.js error boundaries must be Client Components, but
 * this one is a *synchronous* one, unlike the (often async) page.tsx it
 * guards, so it's safe for Vitest to render (see vitest.config.mts).
 */

import type { ReactNode } from "react";
import { Button, Callout } from "@/components/ui";

interface ErrorFallbackAction {
  label: string;
  onClick: () => void;
}

export function ErrorFallback({
  title,
  message,
  retry,
  secondaryAction,
}: {
  title: string;
  message: ReactNode;
  retry: ErrorFallbackAction;
  secondaryAction?: ErrorFallbackAction;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <div className="w-full max-w-sm">
        <Callout tone="error" title={title}>
          {message}
        </Callout>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="ghost" onClick={retry.onClick}>
          {retry.label}
        </Button>
        {secondaryAction && (
          <Button variant="ghost" onClick={secondaryAction.onClick}>
            {secondaryAction.label}
          </Button>
        )}
      </div>
    </div>
  );
}
