"use client";

/**
 * RocketPicker — "Or pick one already converted" (S8/A1): the org's rockets
 * from GET /api/rockets (name, author, saved date — no per-row detail fetch),
 * each with a "Use" action that loads the rocket's newest export and makes
 * it the Workbench's active file. Renders nothing for an org without
 * rockets: the drop zone above is then the whole story.
 */

import Link from "next/link";
import { useMemo } from "react";
import { useRocketLatestExportMutation, useRocketsQuery } from "@/lib/queries";
import { plural } from "@/lib/i18n";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Spinner } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { ghostButton, textLink } from "./styles";

export function RocketPicker() {
  const t = useT();
  const { locale } = useLocale();
  const { setExport } = useWizardDraft();
  const rockets = useRocketsQuery();
  const useLatest = useRocketLatestExportMutation();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }),
    [locale],
  );

  if (rockets.isPending) {
    return (
      <p role="status" className="text-xs text-muted">
        {t("rockets.loading")}
      </p>
    );
  }
  if (rockets.isError) {
    return (
      <p role="alert" className="text-xs text-bad-ink">
        {t("rockets.errorLoad")}
      </p>
    );
  }
  if (rockets.data.length === 0) return null;

  function use(rocketId: string) {
    useLatest.mutate(rocketId, {
      onSuccess: ({ rocket, export: exp }) => {
        setExport(exp.export_id, exp.manifest, rocket.rocket_id, {
          filename: exp.ork_filename,
          rocketName: rocket.name,
        });
      },
    });
  }

  return (
    <Reveal delay={0.08}>
      <section aria-labelledby="pick-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="pick-title" className="text-sm font-semibold text-ink">
            {t("workbench.pickTitle")}
          </h2>
          <span className="text-xs text-muted">{plural(locale, rockets.data.length, "workbench.pickCount")}</span>
          <div className="flex-1" />
          <Link href="/rockets" className={textLink}>
            {t("workbench.pickAll")}
          </Link>
        </div>

        <ul className="flex flex-col divide-y divide-divider rounded-xl border border-border">
          {rockets.data.map((rocket) => {
            const loading = useLatest.isPending && useLatest.variables === rocket.rocket_id;
            return (
              <li key={rocket.rocket_id} className="flex items-center gap-3 px-3 py-2.5">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-accent" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium text-ink">{rocket.name}</span>
                  <span className="truncate text-xs text-muted">
                    {/* An identifier (email / user id): never machine-translated. */}
                    <span translate="no">{rocket.created_by}</span>
                    {" · "}
                    <span className="tabular-nums">{dateFormat.format(new Date(rocket.created_at))}</span>
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={t("workbench.pickUseLabel", { rocket: rocket.name })}
                  disabled={useLatest.isPending}
                  onClick={() => use(rocket.rocket_id)}
                  className={ghostButton}
                >
                  {loading && <Spinner decorative className="h-3.5 w-3.5" />}
                  {t("workbench.pickUse")}
                </button>
              </li>
            );
          })}
        </ul>

        {useLatest.isError && (
          <p role="alert" className="text-xs text-bad-ink">
            {t("rockets.errorUseFailed")}
          </p>
        )}
      </section>
    </Reveal>
  );
}
