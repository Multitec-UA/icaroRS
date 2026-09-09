/**
 * Suspense fallback for the /history list (issue #52). No hooks, no "use
 * client" — rendered by the server while HistoryListServer's fetch is in
 * flight.
 */

import { Spinner } from "@/components/ui";

export function HistoryListSkeleton({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-20 text-muted">
      <Spinner />
      {label}
    </div>
  );
}
