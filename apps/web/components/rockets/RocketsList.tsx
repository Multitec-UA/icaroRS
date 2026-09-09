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
import { useRocketsQuery } from "@/lib/queries";
import { useWizard } from "@/components/wizard/WizardProvider";
import { Button, Callout, Card, Eyebrow, Spinner } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useT } from "@/components/i18n/LocaleProvider";

export function RocketsList() {
  const t = useT();
  const router = useRouter();
  const { setExport, goto } = useWizard();

  const { data: rockets, isLoading: loading, error: queryError } = useRocketsQuery();

  // A 401 is handled globally (lib/query-client.ts); any other error shows a
  // generic load-failure message, same as before.
  const isUnauthorizedError = queryError instanceof ApiError && queryError.isUnauthorized;
  const error = queryError && !isUnauthorizedError ? t("rockets.errorLoad") : null;

  function handleUseRocket(rocket: RocketSummary) {
    // Re-launch flow B: set export_id + manifest in wizard without re-uploading.
    // We only have the summary here (no manifest). Fetch the detail to get it.
    // To avoid an extra round-trip blocker, we import getRocket lazily.
    import("@/lib/api").then(({ getRocket }) =>
      getRocket(rocket.rocket_id).then((detail) => {
        setExport(detail.rocket_id, detail.manifest);
        goto("basics");
        router.push("/");
      }),
    );
  }

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

                {/* Action row */}
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    withArrow
                    onClick={() => handleUseRocket(rocket)}
                  >
                    {t("rockets.useThisRocket")}
                  </Button>
                </div>
              </Card>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
