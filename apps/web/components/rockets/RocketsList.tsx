"use client";

/**
 * RocketsList — reverse-chronological list of saved rockets.
 *
 * Fetches GET /api/rockets and renders each entry as a self-contained bento
 * card (Ethereal Glass / Double-Bezel, via Card from ui.tsx). Every datum
 * carries its own label — no disconnected header row.
 *
 * "Use this rocket" triggers re-launch flow B: calls
 * setExport(rocket_id, manifest) in WizardProvider then navigates to the
 * wizard root — NO .ork re-upload.
 */

import { useRouter } from "next/navigation";
import { ApiError, type RocketSummary } from "@/lib/api";
import { useRocketsQuery, useRocketDetailMutation } from "@/lib/queries";
import { useWizard } from "@/components/wizard/WizardProvider";
import { Button, Callout, Card, Eyebrow, Spinner } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useT } from "@/components/i18n/LocaleProvider";

export function RocketsList() {
  const t = useT();
  const { data: rockets, isLoading: loading, error: queryError } = useRocketsQuery();

  // A 401 is handled globally (lib/query-client.ts); any other error shows a
  // generic load-failure message, same as before.
  const isUnauthorizedError = queryError instanceof ApiError && queryError.isUnauthorized;
  const error = queryError && !isUnauthorizedError ? t("rockets.errorLoad") : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("rockets.eyebrow")}</Eyebrow>
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("rockets.heading")}
        </h1>
        <p className="text-sm text-muted">{t("rockets.description")}</p>
      </header>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-20 text-muted">
          <Spinner />
          {t("rockets.loading")}
        </div>
      )}

      {!loading && error && (
        <Callout tone="error">{error}</Callout>
      )}

      {!loading && !error && rockets?.length === 0 && (
        <Callout tone="info">{t("rockets.empty")}</Callout>
      )}

      {!loading && !error && rockets && rockets.length > 0 && (
        <div className="flex flex-col gap-4">
          {rockets.map((rocket, i) => (
            <Reveal key={rocket.rocket_id} delay={i * 0.04}>
              <RocketCard rocket={rocket} />
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One rocket entry, including its own "Use this rocket" mutation state
 * (issue #50). Previously this fetched the rocket detail via an inline
 * `import("@/lib/api")` with no `.catch()` and no loading state, so a
 * failing request did nothing visible at all. Each card now owns its own
 * useMutation call, so a failure shows an inline error and doesn't affect
 * any other card.
 */
function RocketCard({ rocket }: { rocket: RocketSummary }) {
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
  );
}
