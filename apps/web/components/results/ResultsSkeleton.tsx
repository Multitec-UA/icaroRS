/**
 * Suspense fallback for /results/[runId] (issue #52). No hooks, no "use
 * client" — rendered by the server while ResultsContentServer's fetch is in
 * flight. Matches the loading state ResultsDashboard used to show inline.
 */

import { Spinner } from "@/components/ui";

export function ResultsSkeleton({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-32 text-muted">
      <Spinner /> {label}
    </div>
  );
}
