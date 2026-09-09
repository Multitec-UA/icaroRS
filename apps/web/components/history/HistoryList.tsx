"use client";

/**
 * HistoryList — reverse-chronological simulation history.
 *
 * Fetches GET /api/history and renders each entry as a self-contained bento
 * card (Ethereal Glass / Double-Bezel, via Card from ui.tsx). Every datum
 * carries its own label — no disconnected header row.
 *
 * "Re-run" triggers re-launch flow A: submits the stored (rocket_id, scenario)
 * verbatim to /api/simulate and navigates to the new result page — the
 * original simulation document is NOT mutated.
 *
 * The list itself is a useQuery (issue #48); "Re-run" stays a plain imperative
 * call for now — it moves to a shared useSimulateMutation in a follow-up PR
 * (see the PR description for why this one stops here).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, simulate, type SimulationSummary } from "@/lib/api";
import { useHistoryQuery } from "@/lib/queries";
import { useAuth } from "@/components/auth/AuthGate";
import { Button, Callout, Card, Eyebrow, Spinner, cn } from "@/components/ui";
import { CountUp, Reveal } from "@/components/motion";
import { useT } from "@/components/i18n/LocaleProvider";

export function HistoryList() {
  const t = useT();
  const router = useRouter();
  const { logout } = useAuth();

  const { data: items, isLoading: loading, error: queryError } = useHistoryQuery();

  // A 401 is also handled globally (lib/query-client.ts); any other error
  // shows a generic load-failure message, same as before.
  const isUnauthorizedError = queryError instanceof ApiError && queryError.isUnauthorized;
  const error = queryError && !isUnauthorizedError ? t("history.errorLoad") : null;

  /** Map of simulation_id → run state for in-progress re-runs. */
  const [rerunState, setRerunState] = useState<
    Record<string, { status: "running" } | { status: "error"; httpStatus: number }>
  >({});

  async function handleReRun(item: SimulationSummary) {
    setRerunState((prev) => ({ ...prev, [item.simulation_id]: { status: "running" } }));
    try {
      const result = await simulate(item.rocket_id, item.scenario);
      router.push(`/results/${encodeURIComponent(result.run_id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) return logout();
      const httpStatus = err instanceof ApiError ? err.status : 0;
      setRerunState((prev) => ({
        ...prev,
        [item.simulation_id]: { status: "error", httpStatus },
      }));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12">
      <header className="flex flex-col gap-3">
        <Eyebrow>{t("history.eyebrow")}</Eyebrow>
        <h1 className="text-4xl font-semibold tracking-tight">
          {t("history.heading")}
        </h1>
        <p className="text-sm text-muted">{t("history.description")}</p>
      </header>

      {loading && (
        <div className="flex items-center justify-center gap-2 py-20 text-muted">
          <Spinner />
          {t("history.loading")}
        </div>
      )}

      {!loading && error && (
        <Callout tone="error">{error}</Callout>
      )}

      {!loading && !error && items?.length === 0 && (
        <Callout tone="info">{t("history.empty")}</Callout>
      )}

      {!loading && !error && items && items.length > 0 && (
        <div className="flex flex-col gap-4">
          {items.map((item, i) => {
            const apogee = item.scalars?.["apogee"];
            const apogeeFinite =
              typeof apogee === "number" && Number.isFinite(apogee);
            const rerun = rerunState[item.simulation_id];
            const isRunning = rerun?.status === "running";
            const hasError = rerun?.status === "error";
            const errorHttpStatus =
              hasError && rerun?.status === "error"
                ? (rerun as { status: "error"; httpStatus: number }).httpStatus
                : 0;

            return (
              <Reveal key={item.simulation_id} delay={i * 0.04}>
                <Card innerClassName="flex flex-col gap-5 p-5 sm:p-6">
                  {/* Top row: name + status chip */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <span className="text-base font-medium text-foreground">
                      {item.name}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-3 py-0.5 text-xs font-medium",
                        item.status === "done"
                          ? "bg-emerald-400/10 text-emerald-400 ring-1 ring-emerald-400/25"
                          : "bg-rose-400/10 text-rose-400 ring-1 ring-rose-400/25",
                      )}
                    >
                      {item.status === "done"
                        ? t("history.statusDone")
                        : t("history.statusError")}
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
                          <CountUp
                            value={apogee as number}
                            format={(n) => Math.round(n).toLocaleString()}
                          />
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
                        {new Date(item.created_at).toLocaleString([], {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Re-run error inline */}
                  {hasError && (
                    <p className="text-xs text-rose-400">
                      {t("errors.requestFailed", { status: errorHttpStatus })}
                    </p>
                  )}

                  {/* Action row */}
                  <div className="flex justify-end">
                    <Button
                      variant="ghost"
                      withArrow={!isRunning}
                      disabled={isRunning || item.status === "error"}
                      onClick={() => handleReRun(item)}
                    >
                      {isRunning && <Spinner className="text-cyan-400" />}
                      {t("history.reRun")}
                    </Button>
                  </div>
                </Card>
              </Reveal>
            );
          })}
        </div>
      )}
    </div>
  );
}
