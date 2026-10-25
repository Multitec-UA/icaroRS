"use client";

/**
 * One rocket of the /rockets list — the interactive island inside the
 * server-rendered RocketsListServer (issue #52, on the theme tokens since
 * S9). A rocket groups the .ork files (exports) uploaded for it.
 *
 * "Use this rocket" loads the rocket's newest export and calls
 * setExport(export_id, manifest, rocket_id, { filename, rocketName }) in
 * WizardProvider (the Workbench's rocket button shows those), then opens the
 * Workbench — NO .ork re-upload and no wizard step to jump to. Owns its own
 * mutation state (issue #50) so a failure shows an inline error without
 * affecting any other card. "Runs" opens the comparison board filtered to
 * this rocket.
 *
 * The date goes through Intl with the app locale and a fixed UTC zone: the
 * card is server-rendered first, so the string must not depend on the
 * browser's zone or hydration would mismatch.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, type RocketSummary } from "@/lib/api";
import { useRocketLatestExportMutation } from "@/lib/queries";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Spinner } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { RocketIcon } from "@/components/workbench/icons";
import { ghostButton, textLink } from "@/components/workbench/styles";

export function RocketCard({ rocket, index = 0 }: { rocket: RocketSummary; index?: number }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const { setExport } = useWizardDraft();
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
        router.push("/");
      },
    });
  }

  return (
    // Stagger is capped so a long list doesn't keep its last rows waiting.
    <Reveal delay={Math.min(index, 10) * 0.04} className="h-full">
      <article className="flex h-full flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-soft">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"
          >
            <RocketIcon />
          </span>
          <h2 className="min-w-0 flex-1 break-words text-base font-semibold text-ink">{rocket.name}</h2>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted">{t("rockets.colBy")}</dt>
            {/* An identifier (email / user id): never machine-translated. */}
            <dd translate="no" className="break-words text-ink-2">
              {rocket.created_by}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted">{t("rockets.colDate")}</dt>
            <dd className="tabular-nums text-ink-2">{dateFormat.format(new Date(rocket.created_at))}</dd>
          </div>
        </dl>

        {hasError && (
          <p aria-live="polite" className="text-xs text-bad-ink">
            {t("rockets.errorUseFailed")}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <Link href={`/runs?rocket_id=${encodeURIComponent(rocket.rocket_id)}`} className={textLink}>
            {t("rockets.runs")}
          </Link>
          <button type="button" disabled={isLoadingDetail} onClick={handleUseRocket} className={ghostButton}>
            {isLoadingDetail && <Spinner decorative className="h-3.5 w-3.5 text-accent-ink" />}
            {t("rockets.useThisRocket")}
          </button>
        </div>
      </article>
    </Reveal>
  );
}
