"use client";

/**
 * One simulation-history entry — the interactive island inside the
 * server-rendered /history list (issue #52). Extracted out of
 * HistoryList.tsx so a Server Component can render the (static) list shell
 * and drop this in per row.
 *
 * "View details" opens the stored results page for a finished entry
 * (/results/{simulation_id}) — nothing is recomputed: the simulation id is
 * the run id the results page reads from storage.
 *
 * "Re-run" triggers re-launch flow A: submits the stored (export_id,
 * scenario) verbatim to /api/simulate and navigates to the new result page —
 * the original simulation document is NOT mutated. Owns its own mutation
 * state (issue #48) so re-running one entry never affects any other card.
 * Runs written before the Rocket/Export split carry no export_id, so they
 * cannot be re-run (the stored rocket_id is a group, not a file).
 *
 * Dates and numbers go through Intl with the app locale and a fixed UTC
 * zone: the card is server-rendered first, so the string must not depend on
 * the browser's zone or hydration would mismatch.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, type SimulationSummary } from "@/lib/api";
import { useSimulateMutation } from "@/lib/queries";
import { Button, Card, Spinner } from "@/components/ui";
import { cn, focusRing } from "@/lib/styles";
import { CountUp, Reveal } from "@/components/motion";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";

// Matches components/ui.tsx's Button primary variant — a <Link> navigates
// without a client onClick, so it can't reuse <Button> itself.
const detailsLinkClassName = cn(
  "group relative inline-flex h-12 items-center justify-center gap-2.5 rounded-full px-6 text-sm font-medium transition-[background-color,box-shadow,color,transform,opacity] duration-500 ease-[var(--ease-spring)] active:scale-[0.98] bg-foreground text-[#050505] hover:shadow-[0_0_36px_-6px_rgba(34,211,238,0.55)]",
  focusRing,
);

export function HistoryCard({ item, index = 0 }: { item: SimulationSummary; index?: number }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const rerun = useSimulateMutation();

  const apogeeFormat = useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }),
    [locale],
  );
  const dateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }),
    [locale],
  );

  const apogee = item.scalars?.["apogee"];
  const apogeeFinite = typeof apogee === "number" && Number.isFinite(apogee);

  const isRunning = rerun.isPending;
  const isUnauthorizedError = rerun.error instanceof ApiError && rerun.error.isUnauthorized;
  const hasError = rerun.isError && !isUnauthorizedError;
  const errorHttpStatus = rerun.error instanceof ApiError ? rerun.error.status : 0;
  const reRunUnavailable = item.status === "error" || !item.export_id;
  const reRunUnavailableReason = !item.export_id
    ? t("history.reRunNoExport")
    : t("history.reRunUnavailable");

  function handleReRun() {
    if (!item.export_id) return;
    rerun.mutate(
      { exportId: item.export_id, scenario: item.scenario },
      {
        onSuccess: (result) => router.push(`/results/${encodeURIComponent(result.run_id)}`),
      },
    );
  }

  return (
    // Stagger is capped so a long list doesn't keep its last rows waiting.
    <Reveal delay={Math.min(index, 10) * 0.04}>
      <Card innerClassName="flex flex-col gap-5 p-5 sm:p-6">
        {/* Top row: name + status chip */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="break-words text-base font-medium text-foreground">{item.name}</span>
            {item.ork_filename && (
              // A file name: never machine-translated.
              <span translate="no" className="break-words font-mono text-xs text-muted">
                {item.ork_filename}
              </span>
            )}
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium",
              item.status === "done"
                ? "bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/25"
                : "bg-rose-400/10 text-rose-400 ring-1 ring-rose-400/25",
            )}
          >
            {item.status === "done" ? t("history.statusDone") : t("history.statusError")}
          </span>
        </div>

        {/* Metadata: labeled pairs */}
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          {/* Apogeo */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {t("history.colApogee")}
            </span>
            <span className="tabular-readout text-sm text-foreground">
              {apogeeFinite ? (
                <CountUp value={apogee as number} format={(n) => apogeeFormat.format(n)} />
              ) : (
                "—"
              )}
            </span>
          </div>

          {/* Fecha */}
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
              {t("history.colDate")}
            </span>
            <span className="tabular-readout text-sm text-foreground">
              {dateFormat.format(new Date(item.created_at))}
            </span>
          </div>
        </div>

        {/* Re-run error inline */}
        {hasError && (
          <p aria-live="polite" className="text-xs text-rose-400">
            {t("errors.requestFailed", { status: errorHttpStatus })}
          </p>
        )}

        {/* Action row */}
        <div className="flex flex-wrap justify-end gap-2">
          {item.status === "done" && (
            <Link
              href={`/results/${encodeURIComponent(item.simulation_id)}`}
              className={detailsLinkClassName}
            >
              {t("history.viewDetails")}
            </Link>
          )}
          <Button
            variant="ghost"
            withArrow={!isRunning}
            disabled={isRunning || reRunUnavailable}
            title={reRunUnavailable ? reRunUnavailableReason : undefined}
            onClick={handleReRun}
          >
            {isRunning && <Spinner className="text-cyan-400" />}
            {t("history.reRun")}
            {/* A disabled button gives no reason on its own; say it for assistive tech. */}
            {reRunUnavailable && <span className="sr-only">{reRunUnavailableReason}</span>}
          </Button>
        </div>
      </Card>
    </Reveal>
  );
}
