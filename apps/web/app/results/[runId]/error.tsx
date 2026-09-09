"use client";

/**
 * Route-scoped error boundary for /results/[runId]. Without this file, a
 * crash while rendering a flight's results (e.g. a wiring mistake tripping
 * useWizard/useAuth, or a bug in the interactive charts) would fall through
 * to the root app/error.tsx and blank the whole app instead of just this
 * screen — see issue #49.
 *
 * Nested inside app/layout.tsx's provider stack like every other page, so
 * useT() and useRouter() are safe here.
 */

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/LocaleProvider";
import { ErrorFallback } from "@/components/boundaries/ErrorFallback";

export default function ResultsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  const router = useRouter();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorFallback
      title={t("errors.boundaryTitle")}
      message={t("errors.resultsBoundaryMessage")}
      retry={{ label: t("errors.tryAgain"), onClick: reset }}
      secondaryAction={{
        label: t("results.backToStart"),
        onClick: () => router.push("/"),
      }}
    />
  );
}
