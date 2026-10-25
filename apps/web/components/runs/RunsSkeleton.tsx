/**
 * Suspense fallback for /runs. No hooks, no "use client" — rendered by the
 * server while the client board loads. The wrapper is the single live
 * region: the visible label is what gets announced, so the spinner next to
 * it is decorative.
 */

import { Spinner } from "@/components/ui";

export function RunsSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="flex items-center justify-center gap-2 py-20 text-muted">
      <Spinner decorative />
      {label}
    </div>
  );
}
