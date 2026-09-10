"use client";

/**
 * One saved-rocket entry — the interactive island inside the server-rendered
 * /rockets list (issue #52). Extracted out of RocketsList.tsx so a Server
 * Component can render the (static) list shell and drop this in per row.
 *
 * "Use this rocket" triggers re-launch flow B: calls
 * setExport(rocket_id, manifest) in WizardProvider then navigates to the
 * wizard root — NO .ork re-upload. Owns its own mutation state (issue #50)
 * so a failure shows an inline error without affecting any other card.
 */

import { useRouter } from "next/navigation";
import { ApiError, type RocketSummary } from "@/lib/api";
import { useRocketDetailMutation } from "@/lib/queries";
import { useWizard } from "@/components/wizard/WizardProvider";
import { Button, Card, Spinner } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useT } from "@/components/i18n/LocaleProvider";

export function RocketCard({ rocket, index = 0 }: { rocket: RocketSummary; index?: number }) {
  const t = useT();
  const router = useRouter();
  const { setExport, goto } = useWizard();
  const useRocket = useRocketDetailMutation();

  const isLoadingDetail = useRocket.isPending;
  const isUnauthorizedError = useRocket.error instanceof ApiError && useRocket.error.isUnauthorized;
  const hasError = useRocket.isError && !isUnauthorizedError;

  function handleUseRocket() {
    useRocket.mutate(rocket.rocket_id, {
      onSuccess: (detail) => {
        setExport(detail.rocket_id, detail.manifest);
        goto("basics");
        router.push("/");
      },
    });
  }

  return (
    <Reveal delay={index * 0.04}>
      <Card innerClassName="flex flex-col gap-5 p-5 sm:p-6">
        {/* Top row: rocket name prominent */}
        <span className="text-base font-medium text-foreground">
          {rocket.name}
        </span>

        {/* Metadata: labeled pairs */}
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {/* Lanzado por */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {t("rockets.colBy")}
            </span>
            <span className="text-sm text-foreground">
              {rocket.created_by}
            </span>
          </div>

          {/* Fecha */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {t("rockets.colDate")}
            </span>
            <span className="tabular-readout text-sm text-foreground">
              {new Date(rocket.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>

        {/* Use-this-rocket error inline */}
        {hasError && (
          <p className="text-xs text-rose-400">{t("rockets.errorUseFailed")}</p>
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
