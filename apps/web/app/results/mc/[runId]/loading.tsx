"use client";

/** Route-level pending state for /results/mc/[runId], like /results/[runId]. */

import { useT } from "@/components/i18n/LocaleProvider";
import { LoadingFallback } from "@/components/boundaries/LoadingFallback";

export default function MonteCarloReportLoading() {
  const t = useT();
  return <LoadingFallback label={t("mcReport.loading")} />;
}
