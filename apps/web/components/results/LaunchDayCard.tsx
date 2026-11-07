"use client";

/**
 * LaunchDayCard — the launch-day advisor in the Workbench's results column
 * (launch-day S6b). Presentational: the request and its state live in
 * components/workbench/useLaunchDay.ts.
 *
 *   idle     what the sweep does + "Recommend rail setting"
 *   running  "Simulating 72 flights… about 1–2 minutes" (one synchronous POST)
 *   error    the API's message; the button runs it again
 *   done     the headline with the best setting, the wind used, the 8
 *            closest settings, "Apply to rail", and the L1 checklist for the
 *            current and the recommended setting
 *
 * Every measurement follows the unit system (units S6): distances in m or ft,
 * speeds in m/s or ft/s, the wind in km/h or mph.
 */

import { ApiError } from "@/lib/api";
import type { LaunchCandidate, LaunchDayResult } from "@/lib/api/launchday";
import { plural } from "@/lib/i18n";
import {
  DEFAULT_FLIGHT_COUNT,
  compassPoint,
  headline,
  msToKmh,
  topCandidates,
} from "@/lib/domain/launchday";
import { cn } from "@/lib/styles";
import { Button, Callout, InfoTip, Spinner } from "@/components/ui";
import { cardClass } from "@/components/ui/classes";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import { LaunchChecklist, formatLaunchMeasure } from "./LaunchChecklist";

export type LaunchDayStatus = "idle" | "running" | "error" | "done";

export interface LaunchDayCardProps {
  status: LaunchDayStatus;
  result: LaunchDayResult | null;
  error: unknown;
  /** Why the sweep cannot run now (no site, no date…), or null. */
  disabledReason: string | null;
  /** The recommended setting was written into the rail inputs. */
  applied: boolean;
  onRun: () => void;
  onApply: (candidate: LaunchCandidate) => void;
}

export function LaunchDayCard({ status, result, error, disabledReason, applied, onRun, onApply }: LaunchDayCardProps) {
  const t = useT();
  const running = status === "running";

  return (
    <section aria-label={t("launchday.panelLabel")} className={cn(cardClass, "flex flex-col gap-4 p-5")}>
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
          {t("launchday.title")}
          <InfoTip term="ld_sweep" />
        </h2>
        <span className="flex-1" />
        <Button variant={status === "done" ? "ghost" : "primary"} disabled={running || disabledReason !== null} onClick={onRun}>
          {t("launchday.run")}
        </Button>
      </header>

      {status !== "done" && (
        <p className="text-sm text-ink-2">{t("launchday.intro", { count: DEFAULT_FLIGHT_COUNT })}</p>
      )}
      {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}

      {running && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
          <Spinner decorative className="h-3.5 w-3.5" />
          {t("launchday.running", { count: DEFAULT_FLIGHT_COUNT })}
        </p>
      )}

      {status === "error" && <Callout tone="error">{errorMessage(error, t)}</Callout>}

      {status === "done" && result && <LaunchDayResults result={result} applied={applied} onApply={onApply} />}
    </section>
  );
}

function errorMessage(error: unknown, t: ReturnType<typeof useT>): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return t("launchday.missing");
    if (error.isValidation) {
      return (error.fieldErrors ?? []).map((e) => e.message).join(" ") || error.message;
    }
    return error.hint ?? t(`errors.${error.code}`, { status: error.status });
  }
  return t("launchday.errorFallback");
}

function LaunchDayResults({
  result,
  applied,
  onApply,
}: {
  result: LaunchDayResult;
  applied: boolean;
  onApply: (candidate: LaunchCandidate) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { system, label } = useUnits();
  const best = result.best;
  const words = best ? headline(best, system) : null;
  const measure = (value: number, kind: Parameters<typeof formatLaunchMeasure>[1]) =>
    formatLaunchMeasure(value, kind, system, locale);
  const point = (key: string) => t(`launchday.point.${key}`);
  const top = topCandidates(result.candidates);

  return (
    <div className="flex flex-col gap-4">
      {words ? (
        <Callout tone={words.passes ? "success" : "warning"}>
          <strong>
            {t(words.passes ? "launchday.best" : "launchday.noPass", {
              inclination: words.inclination,
              heading: words.heading,
              headingPoint: point(words.headingPoint),
              distance: `${new Intl.NumberFormat(locale).format(words.distance)} ${label("length")}`,
              landingPoint: point(words.landingPoint),
            })}
          </strong>
        </Callout>
      ) : (
        <Callout tone="warning">{t("launchday.noCandidates")}</Callout>
      )}

      <p className="text-xs text-muted">
        {t("launchday.windUsed", {
          speed: measure(msToKmh(result.wind.speed), "windSpeed"),
          direction: Math.round(result.wind.direction_from),
          source: t(result.wind.source === "manual" ? "launchday.windMeasured" : "launchday.windForecast"),
        })}
      </p>
      {result.skipped.length > 0 && (
        <p className="text-xs text-muted">{plural(locale, result.skipped.length, "launchday.skipped")}</p>
      )}

      {best && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => onApply(best)}>{t("launchday.apply")}</Button>
          {applied && (
            <p role="status" className="text-xs text-ok-ink">
              {t("launchday.applied", { inclination: best.inclination, heading: best.heading })}
            </p>
          )}
        </div>
      )}

      {top.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{t("launchday.tableTitle")}</h3>
          <div className="overflow-x-auto">
            <table aria-label={t("launchday.tableTitle")} className="w-full text-left text-xs tabular-nums">
              <thead className="text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colInclination")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colHeading")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colDistance")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colApogee")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colRailExit")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("launchday.colStability")}</th>
                  <th scope="col" className="py-1 font-medium">{t("launchday.colChecks")}</th>
                </tr>
              </thead>
              <tbody>
                {top.map((c) => (
                  <tr key={`${c.inclination}-${c.heading}`} className="border-t border-divider text-ink">
                    <td className="py-1.5 pr-3">{measure(c.inclination, "angle")}</td>
                    <td className="py-1.5 pr-3">{`${measure(c.heading, "angle")} (${point(compassPoint(c.heading))})`}</td>
                    <td className="py-1.5 pr-3">{measure(c.landing_distance, "length")}</td>
                    <td className="py-1.5 pr-3">{measure(c.apogee_agl, "length")}</td>
                    <td className="py-1.5 pr-3">{measure(c.out_of_rail_velocity, "speed")}</td>
                    <td className="py-1.5 pr-3">{measure(c.stability_margin_min, "stability")}</td>
                    <td className={cn("py-1.5", c.checks_ok ? "text-ok-ink" : "text-bad-ink")}>
                      <span aria-hidden="true">{c.checks_ok ? "✓" : "✗"}</span>
                      <span className="sr-only">{t(c.checks_ok ? "launchday.checksPass" : "launchday.checksFail")}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <LaunchChecklist title={t("launchday.checklistCurrent")} checks={result.checks_current} />
        {result.checks_best && (
          <LaunchChecklist title={t("launchday.checklistBest")} checks={result.checks_best} />
        )}
      </div>
    </div>
  );
}
