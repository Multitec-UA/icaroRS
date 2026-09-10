"use client";

/**
 * Presentational content for a route's loading.tsx. Mirrors the inline
 * "loading" branch ResultsDashboard already renders while it fetches a
 * result client-side, so the Suspense fallback and the component's own
 * loading state look identical — no visible swap between the two.
 */

import { Spinner } from "@/components/ui";

export function LoadingFallback({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-32 text-muted">
      <Spinner /> {label}
    </div>
  );
}
