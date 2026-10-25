"use client";

/**
 * One saved-rocket entry — the interactive island inside the server-rendered
 * /rockets list (issue #52). Extracted out of RocketsList.tsx so a Server
 * Component can render the (static) list shell and drop this in per row.
 *
 * "Use this rocket" triggers re-launch flow B: loads the rocket's newest
 * export (a rocket groups the .ork files uploaded for it), calls
 * setExport(export_id, manifest, rocket_id, { filename, rocketName }) in
 * WizardProvider (the Workbench's rocket button shows those) and navigates
 * to the wizard root — NO .ork re-upload. Owns its own mutation state
 * (issue #50) so a failure shows an inline error without affecting any
 * other card.
 *
 * The date goes through Intl with the app locale and a fixed UTC zone: the
 * card is server-rendered first, so the string must not depend on the
 * browser's zone or hydration would mismatch.
 */

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { ApiError, type RocketSummary } from "@/lib/api";
import { useRocketLatestExportMutation } from "@/lib/queries";
import { useWizard } from "@/components/wizard/WizardProvider";
import { Button, Card, Spinner } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";

export function RocketCard({ rocket, index = 0 }: { rocket: RocketSummary; index?: number }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { setExport, goto } = useWizard();
  const useRocket = useRocketLatestExportMutation();

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }),
    [locale],
  );

  const isLoadingDetail = useRocket.isPending;
  const isUnauthorizedError = useRocket.error instanceof ApiError && useRocket.error.isUnauthorized;
  const hasError = useRocket.isError && !isUnauthorizedError;

  function handleUseRocket() {
    useRocket.mutate(rocket.rocket_id, {
      onSuccess: ({ rocket: detail, export: exp }) => {
        setExport(exp.export_id, exp.manifest, detail.rocket_id, {
          filename: exp.ork_filename,
          rocketName: detail.name,
        });
        goto("basics");
        router.push("/");
      },
    });
  }

  return (
    // Stagger is capped so a long list doesn't keep its last rows waiting.
    <Reveal delay={Math.min(index, 10) * 0.04}>
      <Card innerClassName="flex flex-col gap-5 p-5 sm:p-6">
        {/* Top row: rocket name prominent */}
        <span className="break-words text-base font-medium text-foreground">
          {rocket.name}
        </span>

        {/* Metadata: labeled pairs */}
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {/* Lanzado por */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {t("rockets.colBy")}
            </span>
            {/* An identifier (email / user id): never machine-translated. */}
            <span translate="no" className="break-words text-sm text-foreground">
              {rocket.created_by}
            </span>
          </div>

          {/* Fecha */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {t("rockets.colDate")}
            </span>
            <span className="tabular-readout text-sm text-foreground">
              {dateFormat.format(new Date(rocket.created_at))}
            </span>
          </div>
        </div>

        {/* Use-this-rocket error inline */}
        {hasError && (
          <p aria-live="polite" className="text-xs text-rose-400">
            {t("rockets.errorUseFailed")}
          </p>
        )}

        {/* Action row */}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            withArrow={!isLoadingDetail}
            disabled={isLoadingDetail}
            onClick={handleUseRocket}
          >
            {isLoadingDetail && <Spinner className="text-cyan-400" />}
            {t("rockets.useThisRocket")}
          </Button>
        </div>
      </Card>
    </Reveal>
  );
}
