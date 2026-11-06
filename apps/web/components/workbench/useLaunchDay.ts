"use client";

/**
 * The Workbench's launch-day advisor (launch-day S6b): one synchronous POST
 * /api/launchday with the active file and the scenario on screen (the same
 * `scenarioBody()` /simulate gets, manual wind included), its state, and
 * "Apply to rail".
 *
 * - The POST takes 1–2 minutes and is never retried (`recommendRail`, and
 *   mutations default to `retry: false`): a retry would fly the sweep twice.
 * - A result belongs to the file it was asked for: loading another file
 *   takes it off screen.
 * - Apply to rail writes the recommended inclination and heading as rail
 *   overrides, so the next Run and Dispersion use them (LaunchRailSection
 *   shows them as "Overridden").
 */

import { useCallback, useEffect, useState } from "react";
import { ApiError, type LaunchCandidate } from "@/lib/api";
import { useRecommendRailMutation } from "@/lib/queries";
import { runBlocker } from "@/lib/domain/scenario";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { useT } from "@/components/i18n/LocaleProvider";
import type { LaunchDayCardProps } from "@/components/results/LaunchDayCard";

export function useLaunchDay(): LaunchDayCardProps {
  const t = useT();
  const { state, scenarioBody, setRailOverride } = useWizardDraft();
  const { mutate, data, error, status, variables, reset } = useRecommendRailMutation();
  const [appliedFor, setAppliedFor] = useState<LaunchCandidate | null>(null);
  const exportId = state.exportId;

  const blocker = runBlocker(state);
  const disabledReason =
    exportId === null
      ? t("launchday.needsFile")
      : blocker === "site"
        ? t("launchday.needsSite")
        : blocker === "date"
          ? t("launchday.needsDate")
          : null;

  const onRun = useCallback(() => {
    if (!exportId || disabledReason) return;
    setAppliedFor(null);
    mutate({ export_id: exportId, scenario: scenarioBody() });
  }, [disabledReason, exportId, mutate, scenarioBody]);

  const onApply = useCallback(
    (candidate: LaunchCandidate) => {
      setRailOverride("inclination", candidate.inclination);
      setRailOverride("heading", candidate.heading);
      setAppliedFor(candidate);
    },
    [setRailOverride],
  );

  // Another file is active: what is on screen was asked for the previous one.
  const stale = variables !== undefined && variables.export_id !== exportId;
  useEffect(() => {
    if (stale && status !== "pending") reset();
  }, [reset, stale, status]);

  // A 401 is handled by the session layer (back to the login screen).
  const unauthorized = error instanceof ApiError && error.isUnauthorized;
  const cardStatus =
    stale || status === "idle" || unauthorized
      ? "idle"
      : status === "pending"
        ? "running"
        : status === "error"
          ? "error"
          : "done";

  return {
    status: cardStatus,
    result: cardStatus === "done" ? (data ?? null) : null,
    error: cardStatus === "error" ? error : null,
    disabledReason,
    applied: appliedFor !== null && appliedFor === data?.best,
    onRun,
    onApply,
  };
}
