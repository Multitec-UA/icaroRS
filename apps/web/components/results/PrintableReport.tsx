"use client";

/**
 * PrintableReport — the run report's "Download PDF": a formal technical
 * document, separate from the screen UI, printed only once it is complete.
 *
 * Why not print the screen: the screen keeps sections behind disclosures and
 * mounts the plots only when opened, and the browser snapshots the page right
 * after `beforeprint`, before React re-renders or any PNG arrives, so the
 * PDF came out with closed or empty sections.
 *
 * Flow: `usePrintReport().print()` mounts <PrintReport>, waits for the run's
 * summary and export (the manifest), then for every figure to load (or
 * fail), and only then calls `window.print()`. Ctrl+P (`beforeprint`) mounts
 * it too, as a best effort. While the document is mounted the screen report
 * is `print:hidden` and the document `hidden print:block`.
 *
 * Content and numbers come from the helpers the screen uses (SCALAR_SPECS,
 * flightEvents, rocketSummaryFromManifest, scenarioFacts), so the PDF never
 * disagrees with the UI. Layout: numbered sections, tables with rules and the
 * unit in its own column, numbered figures; page size, margins and the
 * running footer are print CSS (app/globals.css and the @page rule below).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { SimulateResult } from "@/lib/api";
import { useExportDetailQuery, useRunSummaryQuery } from "@/lib/queries";
import { rocketSummaryFromManifest, type RocketSummary } from "@/lib/domain/rocket";
import { scenarioFacts, type ScenarioFacts } from "@/lib/domain/runs";
import { SCALAR_SPECS, formatScalar } from "@/lib/scalars";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import type { MeasureKind } from "@/lib/units";
import { flightEvents, formatNumber, fractionDigitsFor, landingDistance } from "@/components/flight/flightMath";
import { useRunFormatters } from "@/components/runs/useRunFormatters";
import { cn } from "@/lib/styles";
import { fileLabel } from "@/lib/domain/exports";

type ReportResult = Pick<SimulateResult, "scalars" | "warnings" | "plot_urls">;

/** Longest wait for figures before printing anyway (a stuck PNG never blocks the PDF). */
const FIGURE_TIMEOUT_MS = 15_000;

interface PrintApi {
  print: () => void;
  preparing: boolean;
}

const PrintContext = createContext<PrintApi | null>(null);

/** Outside a PrintableReport (no document to build) it falls back to printing the page. */
export function usePrintReport(): PrintApi {
  return useContext(PrintContext) ?? { print: () => window.print(), preparing: false };
}

export function PrintableReport({
  runId,
  result,
  children,
}: {
  runId: string;
  result: ReportResult;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [preparing, setPreparing] = useState(false);

  useEffect(() => {
    const onBeforePrint = () => setMounted(true);
    window.addEventListener("beforeprint", onBeforePrint);
    return () => window.removeEventListener("beforeprint", onBeforePrint);
  }, []);

  const print = useCallback(() => {
    setMounted(true);
    setPreparing(true);
  }, []);

  const onReady = useCallback(() => {
    setPreparing(false);
    window.print();
  }, []);

  const api = useMemo(() => ({ print, preparing }), [print, preparing]);

  return (
    <PrintContext.Provider value={api}>
      {/* `contents`: the wrapper never changes the screen layout (the report's
          sections stay direct children of the page's flex column and keep its gap). */}
      <div className={cn("contents", mounted && "print:hidden")}>{children}</div>
      {mounted && <PrintReport runId={runId} result={result} waiting={preparing} onReady={onReady} />}
    </PrintContext.Provider>
  );
}

function PrintReport({
  runId,
  result,
  waiting,
  onReady,
}: {
  runId: string;
  result: ReportResult;
  waiting: boolean;
  onReady: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { dateTime } = useRunFormatters();
  const summary = useRunSummaryQuery(runId);
  const run = summary.data ?? null;
  const exportId = run?.export_id ?? "";
  const detail = useExportDetailQuery(exportId, { enabled: exportId !== "" });
  const manifest = detail.data?.manifest;
  const rocket = useMemo(() => (manifest ? rocketSummaryFromManifest(manifest) : null), [manifest]);
  const facts = run ? scenarioFacts(run.scenario) : null;
  const dataReady = !summary.isPending && (exportId === "" || !detail.isPending);

  // Figures settle on load OR error: a broken PNG must not hold the PDF.
  const [settled, setSettled] = useState<ReadonlySet<string>>(() => new Set());
  const settle = useCallback((url: string) => {
    setSettled((prev) => (prev.has(url) ? prev : new Set(prev).add(url)));
  }, []);
  const figuresReady = result.plot_urls.every((url) => settled.has(url));

  useEffect(() => {
    if (!waiting || !dataReady) return;
    if (figuresReady) {
      onReady();
      return;
    }
    const timer = window.setTimeout(onReady, FIGURE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [waiting, dataReady, figuresReady, onReady]);

  const utc = (iso: string) => `${dateTime.format(new Date(iso))} UTC`;
  // Stable for the document's lifetime: when it was generated.
  const [generatedAt] = useState(() => new Date().toISOString());
  const footer = t("printReport.footer", { id: runId });

  return (
    <article
      data-print-report
      lang={locale}
      className="print-report palette-light hidden bg-white text-[10pt] leading-snug text-black print:block"
    >
      {/* Running footer and page numbers live in @page margin boxes; their text is per run and locale. */}
      <style>{`@page { @bottom-left { content: ${cssString(footer)}; } }`}</style>

      <header className="mb-6 border-b-2 border-t-[3px] border-b-black border-t-brand pb-3 pt-3">
        <p className="text-[9pt] uppercase tracking-wider text-neutral-600">{t("workbench.brand")}</p>
        <h1 className="mt-1 text-[18pt] font-semibold">{t("printReport.title")}</h1>
        <p className="mt-0.5 text-[13pt]">{run?.name ?? rocket?.name ?? ""}</p>
        <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-0.5 text-[9pt]">
          <Meta label={t("printReport.metaRunId")} value={runId} mono />
          {run && <Meta label={t("printReport.metaSimulatedOn")} value={utc(run.created_at)} />}
          {run && <Meta label={t("printReport.metaAuthor")} value={run.created_by} />}
          {run && <Meta label={t("printReport.metaFile")} value={fileLabel(run.ork_filename, run.ork_revision, run.export_id)} mono />}
          <Meta label={t("printReport.metaGeneratedOn")} value={utc(generatedAt)} />
        </dl>
      </header>

      <SummarySection n={1} scalars={result.scalars} rocket={rocket} />
      <ConfigurationSection n={2} facts={facts} rocket={rocket} utc={utc} />

      <Section n={3} title={t("printReport.warnings")}>
        {result.warnings.length > 0 ? (
          <ul className="list-disc pl-5">
            {result.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        ) : (
          <p>{t("printReport.noWarnings")}</p>
        )}
      </Section>

      <EventsSection n={4} scalars={result.scalars} />
      <ResultsSection n={5} scalars={result.scalars} />

      <Section n={6} title={t("printReport.figures")} breakBefore>
        <div className="grid grid-cols-1 gap-4">
          {result.plot_urls.map((url, index) => (
            <figure key={url} className="break-inside-avoid">
              {/* eslint-disable-next-line @next/next/no-img-element -- printed as-is, no Next image pipeline */}
              <img
                src={url}
                alt={plotTitle(t, url)}
                loading="eager"
                decoding="sync"
                onLoad={() => settle(url)}
                onError={() => settle(url)}
                className="mx-auto max-h-[105mm] w-auto max-w-full border border-neutral-300"
              />
              <figcaption className="mt-1.5 text-center text-[9pt]">
                {t("printReport.figure", { n: index + 1, title: plotTitle(t, url) })}
              </figcaption>
            </figure>
          ))}
        </div>
      </Section>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function SummarySection({
  n,
  scalars,
  rocket,
}: {
  n: number;
  scalars: Record<string, number | null>;
  rocket: RocketSummary | null;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { display, label: unitOf } = useUnits();
  const stored = rocket?.storedResults ?? null;
  const value = (key: string) => finite(scalars[key]);
  const shown = (v: number | null, kind: MeasureKind) => (v === null ? null : display(v, kind));

  const allRows: { key: string; label: string; kind: MeasureKind; icaro: number | null; openRocket: number | null }[] = [
    { key: "apogee_m", label: t("scalars.apogee_m"), kind: "length", icaro: value("apogee_m"), openRocket: stored?.apogeeM ?? null },
    {
      key: "max_velocity_ms",
      label: t("scalars.max_velocity_ms"),
      kind: "speed",
      icaro: value("max_velocity_ms"),
      openRocket: stored?.maxVelocityMs ?? null,
    },
    { key: "max_mach", label: t("scalars.max_mach"), kind: "none", icaro: value("max_mach"), openRocket: null },
    {
      key: "flight_time_s",
      label: t("scalars.flight_time_s"),
      kind: "time",
      icaro: value("flight_time_s"),
      openRocket: stored?.flightTimeS ?? null,
    },
    {
      key: "rail_departure_velocity_ms",
      label: t("scalars.rail_departure_velocity_ms"),
      kind: "speed",
      icaro: value("rail_departure_velocity_ms"),
      openRocket: null,
    },
    {
      key: "rail_departure_stability_margin",
      label: t("scalars.rail_departure_stability_margin"),
      kind: "stability",
      icaro: value("rail_departure_stability_margin"),
      openRocket: null,
    },
    // Only runs that carry it: body lift at the rail-exit angle of attack (S5).
    {
      key: "rail_departure_stability_margin_wind",
      label: t("scalars.rail_departure_stability_margin_wind"),
      kind: "stability",
      icaro: value("rail_departure_stability_margin_wind"),
      openRocket: null,
    },
    {
      key: "landing",
      label: t("printReport.landingDistance"),
      kind: "length",
      icaro: landingDistance(value("impact_x_m"), value("impact_y_m")),
      openRocket: null,
    },
    {
      key: "impact_velocity_ms",
      label: t("scalars.impact_velocity_ms"),
      kind: "speed",
      icaro: value("impact_velocity_ms"),
      openRocket: null,
    },
  ];
  const rows = allRows
    .filter((row) => row.icaro !== null)
    // Every number of a row in the unit system in effect, its label in the unit column.
    .map((row) => ({ ...row, icaro: shown(row.icaro, row.kind), openRocket: shown(row.openRocket, row.kind) }));

  const titleId = useId();
  const title = `${n}. ${t("printReport.summary")}`;
  return (
    <section aria-labelledby={titleId} className="mb-6 break-inside-avoid">
      <h2 id={titleId} className={H2}>
        {title}
      </h2>
      <table aria-labelledby={titleId} className={TABLE}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={TH}>
              {t("printReport.colQuantity")}
            </th>
            <th scope="col" className={TH}>
              {t("printReport.colUnit")}
            </th>
            <th scope="col" className={TH_NUM}>
              {t("printReport.colIcaro")}
            </th>
            <th scope="col" className={TH_NUM}>
              {t("printReport.colOpenRocket")}
            </th>
            <th scope="col" className={TH_NUM}>
              {t("printReport.colDifference")}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={ROW}>
              <th scope="row" className={TD_LABEL}>
                {row.label}
              </th>
              <td className={TD}>{unitOf(row.kind)}</td>
              <td className={TD_NUM}>{formatScalar(row.icaro, "", locale)}</td>
              <td className={TD_NUM}>{formatScalar(row.openRocket, "", locale)}</td>
              <td className={TD_NUM}>
                {row.icaro !== null && row.openRocket !== null
                  ? signed(row.icaro - row.openRocket, fractionDigitsFor(row.icaro), locale)
                  : DASH}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={NOTE}>
        {stored
          ? t("printReport.openRocketNote", { name: stored.simulationName ?? t("printReport.colOpenRocket") })
          : t("printReport.openRocketNone")}
      </p>
    </section>
  );
}

function ConfigurationSection({
  n,
  facts,
  rocket,
  utc,
}: {
  n: number;
  facts: ScenarioFacts | null;
  rocket: RocketSummary | null;
  utc: (iso: string) => string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { modelLabel } = useRunFormatters();
  const { display, label: unitOf } = useUnits();
  const num = (v: number | null | undefined) => (v == null ? DASH : formatNumber(v, locale));
  /** A measurement in the unit system in effect: its number and its unit column. */
  const measure = (v: number | null | undefined, kind: MeasureKind) => ({
    value: v == null ? DASH : formatNumber(display(v, kind), locale),
    unit: unitOf(kind),
  });
  const motor = rocket?.motor ?? null;
  const site = facts?.site ?? null;
  const rail = facts?.rail ?? null;

  const rocketRows: Row[] = rocket
    ? [
        { label: t("printReport.rocketName"), value: rocket.name ?? DASH, unit: "" },
        { label: t("printReport.dryMass"), ...measure(rocket.dryMassKg, "mass") },
        { label: t("printReport.liftoffMass"), ...measure(rocket.liftoffMassKg, "mass") },
        { label: t("printReport.diameter"), ...measure(rocket.diameterMm, "diameter") },
        {
          label: t("printReport.motor"),
          value: motor ? [motor.manufacturer, motor.designation].filter(Boolean).join(" ") || DASH : DASH,
          unit: "",
        },
        { label: t("printReport.totalImpulse"), value: num(motor?.totalImpulseNs), unit: "N·s" },
        { label: t("printReport.burnTime"), value: num(motor?.burnTimeS), unit: "s" },
        {
          label: t("printReport.parachutes"),
          value:
            rocket.parachutes.count > 0
              ? `${rocket.parachutes.count} (${rocket.parachutes.names.join(", ")})`
              : String(rocket.parachutes.count),
          unit: "",
        },
      ]
    : [];

  const launchRows: Row[] = facts
    ? [
        { label: t("printReport.latitude"), value: site ? coordinate(site.latitude) : DASH, unit: "°" },
        { label: t("printReport.longitude"), value: site ? coordinate(site.longitude) : DASH, unit: "°" },
        { label: t("report.configElevation"), ...measure(site?.elevation, "length") },
        { label: t("report.configLaunch"), value: facts.launchDateIso ? utc(facts.launchDateIso) : DASH, unit: "" },
        { label: t("report.configWeather"), value: facts.model ? modelLabel(facts.model) : DASH, unit: "" },
        { label: t("printReport.railLength"), ...measure(rail?.length, "length") },
        { label: t("printReport.railInclination"), value: num(rail?.inclination), unit: "°" },
        { label: t("printReport.railHeading"), value: num(rail?.heading), unit: "°" },
      ]
    : [];

  return (
    <Section n={n} title={t("printReport.configuration")}>
      <div className="grid grid-cols-2 gap-6">
        {rocketRows.length > 0 && <KeyValueTable title={t("printReport.rocket")} rows={rocketRows} />}
        {launchRows.length > 0 && <KeyValueTable title={t("printReport.launch")} rows={launchRows} />}
      </div>
      {!facts && <p>{t("report.detailsUnavailable")}</p>}
    </Section>
  );
}

function EventsSection({ n, scalars }: { n: number; scalars: Record<string, number | null> }) {
  const t = useT();
  const { locale } = useLocale();
  const { system } = useUnits();
  const events = flightEvents(scalars, system);
  const titleId = useId();
  if (events.length === 0) return null;
  return (
    <section aria-labelledby={titleId} className="mb-6 break-inside-avoid">
      <h2 id={titleId} className={H2}>
        {`${n}. ${t("printReport.events")}`}
      </h2>
      <table aria-labelledby={titleId} className={TABLE}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={TH_NUM}>
              {t("printReport.colTime")}
            </th>
            <th scope="col" className={TH}>
              {t("printReport.colEvent")}
            </th>
            <th scope="col" className={TH_NUM}>
              {t("printReport.colValue")}
            </th>
            <th scope="col" className={TH}>
              {t("printReport.colUnit")}
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.key} className={ROW}>
              <td className={TD_NUM}>{formatNumber(event.time, locale)}</td>
              <th scope="row" className={TD_LABEL}>
                {t(event.labelKey)}
              </th>
              <td className={TD_NUM}>{event.value ? formatNumber(event.value.amount, locale) : DASH}</td>
              <td className={TD}>{event.value?.unit ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ResultsSection({ n, scalars }: { n: number; scalars: Record<string, number | null> }) {
  const t = useT();
  const { locale } = useLocale();
  const { display, label: unitOf } = useUnits();
  const titleId = useId();
  const specs = SCALAR_SPECS.filter((spec) => spec.key in scalars);
  return (
    <section aria-labelledby={titleId} className="mb-6 break-inside-avoid">
      <h2 id={titleId} className={H2}>
        {`${n}. ${t("printReport.results")}`}
      </h2>
      <table aria-labelledby={titleId} className={TABLE}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={TH}>
              {t("printReport.colQuantity")}
            </th>
            <th scope="col" className={TH_NUM}>
              {t("printReport.colValue")}
            </th>
            <th scope="col" className={TH}>
              {t("printReport.colUnit")}
            </th>
          </tr>
        </thead>
        <tbody>
          {specs.map((spec) => (
            <tr key={spec.key} className={ROW}>
              <th scope="row" className={TD_LABEL}>
                {t(`scalars.${spec.key}`)}
              </th>
              <td className={TD_NUM}>{formatScalar(shownScalar(scalars[spec.key], spec.kind, display), "", locale)}</td>
              <td className={TD}>{unitOf(spec.kind)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

interface Row {
  label: string;
  value: string;
  unit: string;
}

function Section({
  n,
  title,
  breakBefore = false,
  children,
}: {
  n: number;
  title: string;
  breakBefore?: boolean;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={breakBefore ? "mb-6 break-before-page" : "mb-6"}>
      <h2 id={titleId} className={H2}>
        {`${n}. ${title}`}
      </h2>
      {children}
    </section>
  );
}

function KeyValueTable({ title, rows }: { title: string; rows: Row[] }) {
  const titleId = useId();
  return (
    <div className="break-inside-avoid">
      <h3 id={titleId} className="mb-1 text-[10pt] font-semibold">
        {title}
      </h3>
      <table aria-labelledby={titleId} className={TABLE}>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className={ROW}>
              <th scope="row" className={TD_LABEL}>
                {row.label}
              </th>
              <td className={TD_NUM}>{row.value}</td>
              <td className={cn(TD, "w-10")}>{row.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Meta({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-neutral-600">{label}</dt>
      <dd translate={mono ? "no" : undefined} className={mono ? "font-mono" : undefined}>
        {value}
      </dd>
    </>
  );
}

// Booktabs-style tables: a heavier rule above and below, a thin one under the
// header, no vertical lines; text left, numbers right in tabular figures.
const H2 = "mb-2 text-[12pt] font-semibold break-after-avoid";
const TABLE = "w-full border-collapse border-y-[1.5px] border-black text-[9.5pt]";
const HEAD_ROW = "border-b border-black";
const ROW = "border-b border-neutral-200 last:border-b-0";
const TH = "px-1.5 py-1 text-left align-bottom font-semibold";
const TH_NUM = "px-1.5 py-1 text-right align-bottom font-semibold";
const TD = "px-1.5 py-0.5 text-left align-top";
const TD_LABEL = "px-1.5 py-0.5 text-left align-top font-normal";
const TD_NUM = "px-1.5 py-0.5 text-right align-top tabular-nums";
const NOTE = "mt-1.5 text-[8.5pt] text-neutral-700";
const DASH = "—";

/** A difference at its row's precision (1813 vs 1832 → "-19", never "-19.8"). */
function signed(value: number, digits: number, locale: "en" | "es"): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: digits, signDisplay: "exceptZero" }).format(value);
}

/** A scalar converted to the unit system in effect; null and non-finite stay as they are. */
function shownScalar(
  value: number | null,
  kind: MeasureKind,
  display: (value: number, kind: MeasureKind) => number,
): number | null {
  return value === null || !Number.isFinite(value) ? value : display(value, kind);
}

function finite(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** 5 decimals ≈ 1 m, the precision scenarios are compared at. */
function coordinate(value: number): string {
  return String(Number(value.toFixed(5)));
}

function plotTitle(t: (key: string) => string, url: string): string {
  const stem = url.split("/").pop()?.replace(/\.png$/, "") ?? "plot";
  const key = `plots.${stem}`;
  const title = t(key);
  return title !== key ? title : stem.replace(/_/g, " ");
}

/** A CSS string literal for `content:`; quotes and backslashes escaped. */
function cssString(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, " ")}"`;
}
