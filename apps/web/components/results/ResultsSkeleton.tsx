/**
 * Suspense fallback for /results/[runId] (issue #52). No hooks, no "use
 * client" — rendered by the server while ResultsContentServer's fetch is in
 * flight. Matches the loading state ResultsDashboard used to show inline.
 *
 * The wrapper is the single live region: the visible label is what gets
 * announced, so the spinner next to it is decorative (otherwise assistive
 * tech reads "Loading…" twice).
 */

import { Spinner } from "@/components/ui";

export function ResultsSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 py-32 text-muted"
    >
      <Spinner decorative /> {label}
    </div>
  );
}
