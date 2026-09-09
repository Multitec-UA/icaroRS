"use client";

/**
 * Route-level pending state for /results/[runId] — the app's heaviest
 * route: an async page.tsx (Next 16 awaits dynamic params) that renders a
 * dashboard which itself code-splits three.js/echarts. Shown as an instant
 * loading state during navigation, before ResultsDashboard's own
 * client-side "fetching the result" spinner takes over.
 */

import { useT } from "@/components/i18n/LocaleProvider";
import { LoadingFallback } from "@/components/boundaries/LoadingFallback";

export default function ResultsLoading() {
  const t = useT();
  return <LoadingFallback label={t("results.loadingResults")} />;
}
