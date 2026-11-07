"use client";

/**
 * RealFlightCard: "Real flight" under a run's results (real-flight-compare
 * S6), in the Workbench and in the run report.
 *
 * The MT1 telemetry service publishes its flights to a database Ícaro shares
 * (contract mt-interop schema v1). The card lists them (rocket, flight id,
 * launch date, apogee); picking one asks the API to compare it with this run
 * and shows:
 *
 *   warnings   site far from the real pad, one simulated parachute against a
 *              real ejection + opening, an old run compared approximately…
 *   KPIs       apogee, time to apogee, max speed, landing time, peak
 *              acceleration: simulated, real and the difference
 *   RMSE       of altitude, vertical speed and acceleration over the time
 *              both flights share
 *   charts     altitude, vertical speed, acceleration: simulated (red, solid)
 *              over real (graphite, dashed)
 *   events     rail exit, burnout, apogee, ejection, deploy, landing: sim t,
 *              real t, difference
 *
 * When the API says the org is not part of the interop (`enabled: false`),
 * the card is not rendered at all; when it is but no flight was published
 * yet, it says so. Every number follows the unit system in effect.
 */

import { useId, useMemo, useState, type ReactNode } from "react";
import { ApiError, type FlightComparison, type RealFlightSummary } from "@/lib/api";
import { useFlightComparisonQuery, useRealFlightsQuery } from "@/lib/queries";
import {
  COMPARE_CHARTS,
  chartData,
  eventRows,
  flightOptionParts,
  kpiRows,
  rmseRows,
  signed,
  warningKey,
} from "@/lib/domain/realflight";
import type { Locale } from "@/lib/i18n";
import { cn } from "@/lib/styles";
import type { MeasureKind, UnitSystem } from "@/lib/units";
import { Callout, Field, Select, Spinner } from "@/components/ui";
import { cardClass } from "@/components/ui/classes";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import { formatMeasureQuantity, formatNumber, measureQuantity } from "@/components/flight/flightMath";
import { RealFlightChart } from "./RealFlightChart";

type TranslateFn = ReturnType<typeof useT>;

export function RealFlightCard({ runId }: { runId: string }) {
  const t = useT();
  const flights = useRealFlightsQuery();
  const [flightId, setFlightId] = useState<string | null>(null);
  const comparison = useFlightComparisonQuery(runId, flightId);

  // Not part of the interop (or the list could not load): nothing to offer.
  if (flights.isPending || flights.isError || !flights.data.enabled) return null;
  const list = flights.data.flights;

  return (
    <section aria-label={t("realflight.title")} className={cn(cardClass, "flex flex-col gap-4 p-5")}>
      <header className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-ink">{t("realflight.title")}</h2>
        <p className="text-sm text-ink-2">{t("realflight.intro")}</p>
      </header>

      {list.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-surface-2 px-4 py-3 text-sm text-ink-2">
          {t("realflight.empty")}
        </p>
      ) : (
        <FlightPicker flights={list} value={flightId} onChange={setFlightId} />
      )}

      {flightId !== null && comparison.isPending && (
        <p role="status" className="flex items-center gap-2 text-sm text-ink-2">
          <Spinner decorative className="h-3.5 w-3.5" />
          {t("realflight.comparing")}
        </p>
      )}
      {flightId !== null && comparison.isError && (
        <Callout tone="error">{errorMessage(comparison.error, t)}</Callout>
      )}
      {flightId !== null && comparison.data && <ComparisonView comparison={comparison.data} />}
    </section>
  );
}

function errorMessage(error: unknown, t: TranslateFn): string {
  if (error instanceof ApiError) {
    if (error.status === 404) return t("realflight.noData");
    if (error.status === 422) return t("realflight.badDocument");
    return error.hint ?? t(`errors.${error.code}`, { status: error.status });
  }
  return t("realflight.errorFallback");
}

function FlightPicker({
  flights,
  value,
  onChange,
}: {
  flights: RealFlightSummary[];
  value: string | null;
  onChange: (flightId: string | null) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { system } = useUnits();
  const id = useId();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }),
    [locale],
  );
  const formatDate = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? "" : dateFormat.format(date);
  };

  return (
    <Field label={t("realflight.pickerLabel")} htmlFor={id}>
      <Select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}>
        <option value="">{t("realflight.pickerPlaceholder")}</option>
        {flights.map((flight) => (
          <option key={flight.flight_id} value={flight.flight_id}>
            {flightOptionParts(flight, formatDate, (m) => formatMeasureQuantity(m, "length", system, locale)).join(
              " · ",
            )}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** A measurement in the unit system in effect, or an en dash when missing. */
function measure(value: number | null, kind: MeasureKind, system: UnitSystem, locale: Locale): string {
  return value === null ? "–" : formatMeasureQuantity(value, kind, system, locale);
}

/** A signed difference ("+112 m", "−3.5 s"), or an en dash when a side is missing. */
function delta(value: number | null, kind: MeasureKind, system: UnitSystem, locale: Locale): string {
  if (value === null) return "–";
  const { amount, unit } = measureQuantity(Math.abs(value), kind, system);
  const text = formatNumber(amount, locale);
  return `${signed(text, value)}${unit ? ` ${unit}` : ""}`;
}

function ComparisonView({ comparison }: { comparison: FlightComparison }) {
  const t = useT();
  const { locale } = useLocale();
  const { system } = useUnits();
  const kpis = kpiRows(comparison.kpis);
  const rmse = rmseRows(comparison.rmse);
  const events = eventRows(comparison.events);
  const m = (value: number | null | undefined, kind: MeasureKind) => measure(value ?? null, kind, system, locale);
  const d = (value: number | null | undefined, kind: MeasureKind) => delta(value ?? null, kind, system, locale);

  return (
    <div className="flex flex-col gap-4" data-comparison={comparison.flight_id}>
      {comparison.warnings.length > 0 && (
        <Callout tone="warning" title={t("realflight.warningsTitle")}>
          <ul className="list-disc pl-5">
            {comparison.warnings.map((w) => {
              const key = warningKey(w.code);
              return (
                <li key={w.code}>
                  {key
                    ? t(key, {
                        distance: w.value != null ? m(w.value, "length") : "",
                        time: w.value != null ? m(w.value, "time") : "",
                      })
                    : w.message}
                </li>
              );
            })}
          </ul>
        </Callout>
      )}

      {kpis.length > 0 && (
        <Block title={t("realflight.kpisTitle")}>
          <div className="overflow-x-auto">
            <table aria-label={t("realflight.kpisTitle")} className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("realflight.colQuantity")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("realflight.colSim")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("realflight.colReal")}</th>
                  <th scope="col" className="py-1 font-medium">{t("realflight.colDelta")}</th>
                </tr>
              </thead>
              <tbody>
                {kpis.map((row) => (
                  <tr key={row.id} className="border-t border-divider text-ink">
                    <th scope="row" className="py-1.5 pr-3 font-normal text-ink-2">{t(`realflight.kpi.${row.id}`)}</th>
                    <td className="py-1.5 pr-3">{m(row.sim, row.kind)}</td>
                    <td className="py-1.5 pr-3">{m(row.real, row.kind)}</td>
                    <td className="py-1.5">
                      {d(row.delta, row.kind)}
                      {row.deltaPct !== null && (
                        <span className="text-muted">{` (${signed(formatNumber(Math.abs(row.deltaPct), locale, 1), row.deltaPct)} %)`}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rmse.length > 0 && (
            <p className="text-xs text-muted">
              {t("realflight.rmseLine", {
                values: rmse.map((r) => `${t(`realflight.rmse.${r.key}`)} ${m(r.value, r.kind)}`).join(" · "),
                start: m(comparison.window?.t_start, "time"),
                end: m(comparison.window?.t_end, "time"),
              })}
            </p>
          )}
        </Block>
      )}

      <div className="grid gap-5">
        {COMPARE_CHARTS.map((chart) => {
          const data = chartData(comparison, chart.key);
          return data ? <RealFlightChart key={chart.key} title={t(chart.labelKey)} data={data} kind={chart.kind} /> : null;
        })}
      </div>

      {events.length > 0 && (
        <Block title={t("realflight.eventsTitle")}>
          <div className="overflow-x-auto">
            <table aria-label={t("realflight.eventsTitle")} className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("realflight.colEvent")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("realflight.colSimT")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("realflight.colRealT")}</th>
                  <th scope="col" className="py-1 pr-3 font-medium">{t("realflight.colDelta")}</th>
                  <th scope="col" className="py-1 font-medium">{t("realflight.colAltitude")}</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, index) => (
                  <tr key={`${e.id}-${index}`} className="border-t border-divider text-ink">
                    <th scope="row" className="py-1.5 pr-3 font-normal text-ink-2">
                      {t(`realflight.event.${e.id}`)}
                      {e.ordinal !== null && ` ${e.ordinal}`}
                    </th>
                    <td className="py-1.5 pr-3">{m(e.sim_t, "time")}</td>
                    <td className="py-1.5 pr-3">{m(e.real_t, "time")}</td>
                    <td className="py-1.5 pr-3">{d(e.delta_t, "time")}</td>
                    <td className="py-1.5">
                      {e.value_unit === "m" && (e.sim_value != null || e.real_value != null)
                        ? t("realflight.altitudePair", {
                            sim: m(e.sim_value, "length"),
                            real: m(e.real_value, "length"),
                          })
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">{t("realflight.deltaNote")}</p>
        </Block>
      )}
    </div>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      {children}
    </div>
  );
}
