"use client";

/**
 * RocketSummaryCard (S3) — what the active `.ork` says about the rocket,
 * shown before anything has run: name and file, a metric grid (dry and
 * liftoff mass, diameter, motor, parachutes, rail defaults), OpenRocket's
 * own stored results (its own conditions, never compared with a run), and
 * the "Ready to run" line.
 *
 * `compact` is the per-file variant of the rocket panel: the metric grid
 * only, no header, stored results or ready line.
 *
 * The Motor row names the motor ("{manufacturer} {designation}") over
 * "{impulse} N·s · {burn} s burn · {propellant} kg propellant", each part
 * only when the manifest has it; an old manifest keeps the propellant alone.
 * The stored-results block carries the simulation's name and a status pill
 * (none when the status is unknown), and warns when it is not up to date.
 *
 * Every missing value renders as "—" (see `lib/domain/rocket.ts`).
 */

import { useId, useMemo, type ComponentProps } from "react";
import type { RocketSummary, StoredResultsStatus } from "@/lib/domain/rocket";
import { StatusPill } from "@/components/ui";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import { cn } from "@/lib/styles";
import { RocketIcon } from "./icons";

const DASH = "—";

type MessageKey = Parameters<ReturnType<typeof useT>>[0];
type Tone = NonNullable<ComponentProps<typeof StatusPill>["tone"]>;

const STATUS_PILL: Partial<Record<StoredResultsStatus, { tone: Tone; label: MessageKey }>> = {
  uptodate: { tone: "ok", label: "workbench.cardStatusUptodate" },
  outdated: { tone: "warn", label: "workbench.cardStatusOutdated" },
  loaded: { tone: "neutral", label: "workbench.cardStatusLoaded" },
};

export function RocketSummaryCard({
  summary,
  name,
  file,
  compact = false,
}: {
  summary: RocketSummary;
  /** The rocket's name; falls back to the design name stored in the file. */
  name?: string | null;
  file?: string | null;
  compact?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { system, display, label } = useUnits();
  const headingId = useId();
  const fmt = useMemo(() => {
    const make = (digits: number) =>
      new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    return { fixed2: new Intl.NumberFormat(locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 }), d0: make(0), d1: make(1), d2: make(2) };
  }, [locale]);

  // Same precision in both systems (two decimals for masses and the rail);
  // the diameter gains two decimals in inches, where whole units say too little.
  const kg = (v: number | null) => (v === null ? DASH : `${fmt.fixed2.format(display(v, "mass"))} ${label("mass")}`);
  const diameterFmt = system === "imperial" ? fmt.d2 : fmt.d0;
  const rail = summary.railDefaults;
  const railParts = [
    rail.length === null ? DASH : `${fmt.d2.format(display(rail.length, "length"))} ${label("length")}`,
    rail.inclination === null ? DASH : `${fmt.d1.format(rail.inclination)}°`,
    rail.heading === null ? DASH : `${fmt.d1.format(rail.heading)}°`,
  ];
  const hasRail = rail.length !== null || rail.inclination !== null || rail.heading !== null;
  const title = name ?? summary.name ?? DASH;

  const motor = summary.motor;
  const motorName = motor ? [motor.manufacturer, motor.designation].filter(Boolean).join(" ") : "";
  const motorParts = motor
    ? [
        motor.totalImpulseNs !== null && t("workbench.cardImpulse", { value: fmt.d0.format(motor.totalImpulseNs) }),
        motor.burnTimeS !== null && t("workbench.cardBurnTime", { value: fmt.d2.format(motor.burnTimeS) }),
        motor.propellantMassKg !== null && t("workbench.cardPropellant", { mass: kg(motor.propellantMassKg) }),
      ].filter((part): part is string => typeof part === "string")
    : [];
  const motorLine = motorParts.join(" · ");

  const metrics: Array<{ key: string; term: string; value: string; note?: string; mono?: boolean }> = [
    { key: "dry", term: t("workbench.cardDryMass"), value: kg(summary.dryMassKg), mono: true },
    {
      key: "liftoff",
      term: t("workbench.cardLiftoffMass"),
      value: kg(summary.liftoffMassKg),
      note: summary.liftoffMassKg !== null ? t("workbench.cardWithPropellant") : undefined,
      mono: true,
    },
    {
      key: "diameter",
      term: t("workbench.cardDiameter"),
      value:
        summary.diameterMm === null
          ? DASH
          : `${diameterFmt.format(display(summary.diameterMm, "diameter"))} ${label("diameter")}`,
      mono: true,
    },
    {
      key: "motor",
      term: t("workbench.cardMotor"),
      // Named: the name over the details line; unnamed (old manifests): the details alone.
      value: motorName || motorLine || DASH,
      note: motorName && motorLine ? motorLine : undefined,
    },
    {
      key: "parachutes",
      term: t("workbench.cardParachutes"),
      value: summary.parachutes.count === 0 ? DASH : String(summary.parachutes.count),
      note: summary.parachutes.names.length > 0 ? summary.parachutes.names.join(" · ") : undefined,
    },
    {
      key: "rail",
      term: t("workbench.cardRailDefaults"),
      value: hasRail ? railParts.join(" · ") : DASH,
      note: hasRail ? t("workbench.cardRailOrder") : undefined,
      mono: true,
    },
  ];

  const grid = (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
      {metrics.map((m) => (
        <div key={m.key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-xs text-muted">{m.term}</dt>
          <dd className={cn("min-w-0 text-ink", compact ? "text-[13px]" : "text-sm")}>
            <span className={cn(m.mono && "font-mono tabular-nums")}>{m.value}</span>
            {/* The rail's "length · inclination · heading" legend does not fit the compact grid. */}
            {m.note && !(compact && m.key === "rail") && (
              <small className="block truncate text-xs text-muted">{m.note}</small>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );

  if (compact) {
    return (
      <div aria-label={t("workbench.cardLabel", { rocket: title })} role="group" className="rounded-lg bg-surface-2 px-3 py-2.5">
        {grid}
      </div>
    );
  }

  const stored = summary.storedResults;
  const pill = stored ? STATUS_PILL[stored.status] : undefined;
  const stale = stored?.status === "outdated" || stored?.status === "loaded";
  const storedItems = stored
    ? [
        { key: "apogee", label: t("workbench.cardApogee"), value: stored.apogeeM, kind: "length" as const },
        { key: "speed", label: t("workbench.cardMaxSpeed"), value: stored.maxVelocityMs, kind: "speed" as const },
        { key: "time", label: t("workbench.cardFlightTime"), value: stored.flightTimeS, kind: "time" as const },
      ]
    : [];

  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5 shadow-soft"
    >
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">{t("workbench.cardEyebrow")}</p>
          <h3 id={headingId} className="truncate text-lg font-semibold text-ink">
            {title}
          </h3>
          {file && <p className="truncate font-mono text-[13px] text-ink-2">{file}</p>}
        </div>
        <span className="ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-chip px-3 text-[13px] font-medium text-ink-2">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
          {t("workbench.cardReady")}
        </span>
      </div>

      {grid}

      {stored && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-surface-2 px-3.5 py-3 text-[13px] text-ink-2">
          <span className="flex min-w-0 flex-col gap-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-[0.04em] text-muted">
                {stored.simulationName
                  ? t("workbench.cardStoredTitleNamed", { name: stored.simulationName })
                  : t("workbench.cardStoredTitle")}
              </span>
              {pill && (
                <StatusPill tone={pill.tone} className="h-6 text-xs">
                  {t(pill.label)}
                </StatusPill>
              )}
            </span>
            <span className="text-xs">{t(stale ? "workbench.cardStoredStale" : "workbench.cardStoredNote")}</span>
          </span>
          {storedItems.map((item) => (
            <span key={item.key}>
              {item.label}{" "}
              <b className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                {item.value === null ? DASH : `${fmt.d0.format(display(item.value, item.kind))} ${label(item.kind)}`}
              </b>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2.5 rounded-xl bg-accent-soft px-3.5 py-3 text-sm text-accent-ink">
        <RocketIcon className="shrink-0" />
        <p>{t("workbench.cardReadyLine")}</p>
      </div>
    </article>
  );
}
