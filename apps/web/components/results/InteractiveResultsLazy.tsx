"use client";

/**
 * `next/dynamic(..., { ssr: false })` is only allowed in a Client Component
 * (Next 16 build-errors otherwise) — ResultsContentServer that renders this
 * is now a Server Component (issue #52), so the dynamic-with-ssr:false call
 * itself has to live in this tiny client wrapper instead of inline there.
 */

import dynamic from "next/dynamic";
import { Spinner } from "@/components/ui";

export const InteractiveResultsLazy = dynamic(
  () => import("@/components/results/InteractiveResults").then((m) => m.InteractiveResults),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center gap-2 py-12 text-muted">
        <Spinner />
      </div>
    ),
  },
);
