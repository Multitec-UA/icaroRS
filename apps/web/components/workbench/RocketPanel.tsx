"use client";

/**
 * RocketPanel — the dialog behind the top bar's rocket context button
 * (S8/A3): the active rocket's files (GET /api/rockets/{id}, newest first)
 * as a radio list where the checked one feeds the Workbench, a "Compare two
 * files" link, a drop zone that adds a `.ork` to THIS rocket (destination
 * known, no card), the org's other rockets as chips, and "+ New rocket from
 * .ork" which goes through the destination card with "New rocket" preselected.
 *
 * Dialog semantics: role="dialog" + aria-modal, labelled by the rocket name,
 * focus moves into it on open and back to the trigger on close (Escape, the
 * close button, or after an action that leaves the panel); a pointer press
 * outside closes it without stealing focus from where the user clicked.
 * Tab wraps inside while open. Full-width bottom sheet under 640px, a
 * 560px panel anchored to the trigger on wider screens.
 */

import Link from "next/link";
import { useEffect, useMemo, useRef, type KeyboardEvent, type RefObject } from "react";
import {
  useExportDetailMutation,
  useHistoryQuery,
  useRocketDetailQuery,
  useRocketLatestExportMutation,
  useRocketsQuery,
} from "@/lib/queries";
import type { ExportSummary } from "@/lib/api";
import { plural } from "@/lib/i18n";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Spinner } from "@/components/ui";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { ImportDropZone } from "./ImportDropZone";
import { CloseIcon, RocketIcon } from "./icons";
import { chipButton, textLink } from "./styles";
import type { OrkImport } from "./useOrkImport";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function RocketPanel({
  id,
  rocketId,
  anchorRef,
  importer,
  onClose,
}: {
  id: string;
  rocketId: string;
  /** The trigger: presses on it toggle the panel, so they never count as "outside". */
  anchorRef: RefObject<HTMLElement | null>;
  importer: OrkImport;
  /** `returnFocus` is false for an outside press — focus stays where the user clicked. */
  onClose: (returnFocus: boolean) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { state, setExport } = useWizardDraft();
  const detail = useRocketDetailQuery(rocketId);
  const rockets = useRocketsQuery();
  // Run counts per file come from the rocket's history (S10: computed
  // client-side, no denormalised counters). One page is the API's maximum;
  // a rocket with more runs than that shows the counts of its latest hundred.
  const runs = useHistoryQuery({ rocketId, limit: 100 });
  const runCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of runs.data ?? []) {
      if (row.export_id) counts.set(row.export_id, (counts.get(row.export_id) ?? 0) + 1);
    }
    return counts;
  }, [runs.data]);
  const loadExport = useExportDetailMutation();
  const useLatest = useRocketLatestExportMutation();
  const panelRef = useRef<HTMLElement>(null);
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }),
    [locale],
  );

  const rocketName = detail.data?.name ?? state.rocketName ?? "";
  const exports = detail.data?.exports ?? [];
  const others = (rockets.data ?? []).filter((rocket) => rocket.rocket_id !== rocketId);

  // Focus moves into the dialog as it opens (it is mounted only while open).
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onClose(true);
    }
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [anchorRef, onClose]);

  function trapTab(event: KeyboardEvent<HTMLElement>) {
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === panelRef.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function activate(exp: ExportSummary) {
    if (exp.export_id === state.exportId) return;
    loadExport.mutate(exp.export_id, {
      onSuccess: (full) => {
        setExport(full.export_id, full.manifest, rocketId, {
          filename: full.ork_filename,
          rocketName,
        });
      },
    });
  }

  function switchRocket(otherId: string) {
    useLatest.mutate(otherId, {
      onSuccess: ({ rocket, export: exp }) => {
        setExport(exp.export_id, exp.manifest, rocket.rocket_id, {
          filename: exp.ork_filename,
          rocketName: rocket.name,
        });
      },
    });
  }

  const busy = loadExport.isPending || useLatest.isPending;

  return (
    <section
      ref={panelRef}
      id={id}
      role="dialog"
      aria-modal="true"
      aria-label={t("workbench.panelLabel", { rocket: rocketName })}
      tabIndex={-1}
      onKeyDown={trapTab}
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 flex max-h-[85dvh] flex-col overflow-hidden rounded-t-2xl border border-border bg-surface text-left shadow-soft-lg outline-none",
        "sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-4 sm:top-[calc(100%+6px)] sm:w-[560px] sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl",
      )}
    >
      <header className="flex items-center gap-3 border-b border-divider px-4 py-3.5">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"
        >
          <RocketIcon />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h2 className="truncate text-base font-semibold text-ink">{rocketName}</h2>
          <span className="text-xs text-muted">
            {detail.isPending ? t("common.loading") : plural(locale, exports.length, "workbench.panelFiles")}
          </span>
        </div>
        <Link href="/rockets" className={textLink}>
          {t("workbench.panelOpenInRockets")}
        </Link>
        <button
          type="button"
          aria-label={t("workbench.panelClose")}
          onClick={() => onClose(true)}
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors duration-300 hover:bg-surface-2 hover:text-ink",
            focusRing,
          )}
        >
          <CloseIcon />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h3 className="text-xs font-medium text-ink">{t("workbench.panelFilesTitle")}</h3>
            <span className="text-xs text-muted">· {t("workbench.panelFilesHint")}</span>
            <div className="flex-1" />
            <Link href={`/runs?rocket_id=${encodeURIComponent(rocketId)}`} className={textLink}>
              {t("workbench.panelCompare")}
            </Link>
          </div>

          {detail.isError && (
            <p role="alert" className="text-xs text-bad-ink">
              {t("workbench.panelFilesError")}
            </p>
          )}

          <div role="radiogroup" aria-label={t("workbench.panelActiveFile")} className="flex flex-col gap-1">
            {exports.map((exp) => {
              const active = exp.export_id === state.exportId;
              const loading = loadExport.isPending && loadExport.variables === exp.export_id;
              return (
                <label
                  key={exp.export_id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-[border-color,background-color] duration-300 ease-[var(--ease-spring)]",
                    active ? "border-accent bg-accent-soft/40" : "border-transparent hover:bg-surface-2",
                  )}
                >
                  <input
                    type="radio"
                    name="active-file"
                    value={exp.export_id}
                    checked={active}
                    disabled={busy}
                    onChange={() => activate(exp)}
                    className="h-4 w-4 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-mono text-[13px] text-ink">
                      {exp.ork_filename ?? exp.export_id}
                    </span>
                    <span className="truncate text-xs text-muted">
                      <span translate="no">{exp.created_by}</span>
                      {" · "}
                      <span className="tabular-nums">{dateFormat.format(new Date(exp.created_at))}</span>
                      {runs.data && (
                        <>
                          {" · "}
                          <span className="tabular-nums">
                            {plural(locale, runCounts.get(exp.export_id) ?? 0, "workbench.panelRuns")}
                          </span>
                        </>
                      )}
                    </span>
                  </span>
                  {loading && <Spinner decorative className="h-3.5 w-3.5 text-accent-ink" />}
                </label>
              );
            })}
          </div>

          {(loadExport.isError || useLatest.isError) && (
            <p role="alert" className="text-xs text-bad-ink">
              {t("rockets.errorUseFailed")}
            </p>
          )}
        </section>

        <ImportDropZone
          compact
          title={t("workbench.panelDropTitle", { rocket: rocketName })}
          hint={t("workbench.panelDropHint")}
          inputLabel={t("workbench.panelDropInputLabel", { rocket: rocketName })}
          inputName="rocket-panel-file"
          onFile={(file) => {
            importer.pick(file, rocketId);
            onClose(true);
          }}
        />

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-ink">{t("workbench.panelOthers")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            {others.map((rocket) => (
              <button
                key={rocket.rocket_id}
                type="button"
                disabled={busy}
                onClick={() => switchRocket(rocket.rocket_id)}
                className={chipButton}
              >
                <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span className="truncate">{rocket.name}</span>
              </button>
            ))}
            <label
              className={cn(
                chipButton,
                "cursor-pointer border border-dashed border-axis bg-transparent has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60",
              )}
            >
              <input
                type="file"
                name="rocket-panel-new-file"
                accept=".ork"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  importer.pick(file);
                  onClose(true);
                }}
              />
              {t("workbench.panelNewRocket")}
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}
