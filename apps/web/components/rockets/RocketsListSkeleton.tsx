/**
 * Suspense fallback for the /rockets list (issue #52). No hooks, no "use
 * client" — it's rendered by the server while RocketsListServer's fetch is
 * in flight, and reused as-is if this boundary ever re-suspends on the
 * client.
 *
 * The wrapper is the single live region: the visible label is what gets
 * announced, so the spinner next to it is decorative.
 */

import { Spinner } from "@/components/ui";

export function RocketsListSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-center gap-2 py-20 text-muted"
    >
      <Spinner decorative />
      {label}
    </div>
  );
}
