"use client";

/**
 * LaunchChecklist — the SURT x SpainRocketry L1 limits as a go/no-go table
 * for one rail setting (launch-day S6b). One row per check the API returned
 * (`checks_current` / `checks_best`): what is checked, the simulated value
 * with its unit, the limit (and whether it is a hard limit or a
 * recommendation), the guide's requirement id or "Common practice", and the
 * status: green = passes, amber = a recommendation is missed (soft), red =
 * a limit is broken (hard). Every rule has an InfoTip in plain words.
 */

import type { LaunchCheck } from "@/lib/api/launchday";
import { CHECK_UNIT, checkStatus, requirementLabel, statusTone, type CheckStatus } from "@/lib/domain/launchday";
import { cn } from "@/lib/styles";
import { InfoTip, toneClass } from "@/components/ui";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";

const STATUS_KEY: Record<CheckStatus, "launchday.statusOk" | "launchday.statusSoft" | "launchday.statusHard"> = {
  ok: "launchday.statusOk",
  soft: "launchday.statusSoft",
  hard: "launchday.statusHard",
};

const COMPARATOR: Record<LaunchCheck["comparator"], string> = { "<=": "≤ ", ">=": "≥ ", between: "" };

/** Decimals shown per unit: calibres to the hundredth, speeds and angles to the tenth. */
function decimalsFor(unit: string): number {
  if (unit === "cal") return 2;
  if (unit === "m/s" || unit === "°") return 1;
  return 0;
}

export function formatMeasure(value: number, unit: string, locale: string): string {
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: decimalsFor(unit) }).format(value);
  return unit === "°" ? `${number}°` : `${number} ${unit}`;
}

function formatLimit(check: LaunchCheck, locale: string): string {
  const unit = CHECK_UNIT[check.id];
  if (Array.isArray(check.limit)) {
    const [low, high] = check.limit;
    const format = new Intl.NumberFormat(locale, { maximumFractionDigits: decimalsFor(unit) });
    return `${format.format(low)}–${formatMeasure(high, unit, locale)}`;
  }
  return `${COMPARATOR[check.comparator]}${formatMeasure(check.limit, unit, locale)}`;
}

export function LaunchChecklist({ title, checks }: { title: string; checks: readonly LaunchCheck[] }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="overflow-x-auto">
        <table aria-label={title} className="w-full text-left text-xs">
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colCheck")}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colValue")}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colLimit")}</th>
              <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colRequirement")}</th>
              <th scope="col" className="py-1 font-medium">{t("launchday.colStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {checks.map((check) => {
              const status = checkStatus(check);
              const tone = statusTone(status);
              const requirement = requirementLabel(check.source);
              return (
                <tr key={check.id} className="border-t border-divider align-middle">
                  <td className="py-1.5 pr-3 text-ink">
                    <span className="inline-flex items-center gap-1">
                      {t(`launchday.check.${check.id}`)}
                      <InfoTip term={`ld_${check.id}`} />
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-ink">
                    {formatMeasure(check.value, CHECK_UNIT[check.id], locale)}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums text-ink-2">
                    {`${formatLimit(check, locale)} · ${t(check.severity === "hard" ? "launchday.severityHard" : "launchday.severitySoft")}`}
                  </td>
                  <td className="py-1.5 pr-3 text-ink-2">{requirement ?? t("launchday.commonPractice")}</td>
                  <td className="py-1.5">
                    <span
                      data-tone={tone}
                      className={cn("whitespace-nowrap rounded-full px-2 py-0.5 font-medium", toneClass[tone])}
                    >
                      {t(STATUS_KEY[status])}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
