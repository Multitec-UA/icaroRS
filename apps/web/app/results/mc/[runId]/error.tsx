"use client";

/**
 * Route-scoped error boundary for /results/mc/[runId]: a crash while
 * rendering the dispersion report stays on this screen instead of falling
 * through to the root app/error.tsx (see /results/[runId]/error.tsx).
 */

import { useEffect } from "react";
import { useT } from "@/components/i18n/LocaleProvider";
import { ErrorFallback } from "@/components/boundaries/ErrorFallback";

export default function MonteCarloReportError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorFallback
      title={t("errors.boundaryTitle")}
      message={t("mcReport.boundaryMessage")}
      retry={{ label: t("errors.tryAgain"), onClick: reset }}
      secondaryAction={{ label: t("mcReport.backToRuns"), href: "/runs" }}
    />
  );
}
