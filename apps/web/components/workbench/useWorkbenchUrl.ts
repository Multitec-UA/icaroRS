"use client";

/**
 * The Workbench's state in its URL (S8). The draft (WizardProvider) holds
 * the file, scenario and displayed run; this hook keeps the query string in
 * step with it, both ways:
 *
 *   /                       nothing loaded
 *   /?file={export_id}      a file is loaded and no run is displayed
 *   /?run={run_id}          a run is displayed
 *
 * Reading (on mount, and whenever the query string changes — back/forward,
 * a link from /runs or the report): a `run` the draft does not show is
 * loaded from `GET /api/history/{id}` (scenario, export, result) and
 * `GET /api/exports/{export_id}` (manifest, name, file), then put on screen
 * with `showRun`, so the status reads "Up to date · run {id}". A `file` the
 * draft does not hold is loaded with `setExport`; a `file` URL never shows a
 * run, so going back from `?run=` to `?file=` takes the run off screen and
 * keeps the draft. No parameter loads nothing: a draft kept in memory (the
 * user came back through the sidebar) is written into the URL instead.
 *
 * Writing: `router.replace` while the file changes (no history entry per
 * edit; scenario edits never touch the URL at all), `router.push` when a new
 * run comes on screen, so the browser back button returns to the state
 * before it.
 *
 * A 404 on the run, its file or the file leaves a `missing` status that the
 * results column explains (never a blank Workbench, never a thrown error);
 * `startFresh` resets the draft, clears the URL and forgets stored drafts.
 *
 * Refresh (S12l): the URL names the run, not the edits made after it, so
 * the draft's scenario fields are also saved to `sessionStorage` under
 * `icaro:draft:{exportId}` (lib/draft-storage), synchronously on every
 * change once the URL is settled, with the displayed run they started from.
 * When `?run=` resolves, a stored draft of the same export and run replaces
 * the run's own scenario, so the pill reads "Changed since run {id}" again
 * with the same chips. A stored draft of another run is left alone.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, plotUrl } from "@/lib/api";
import { exportDetailQuery, runSummaryQuery } from "@/lib/queries";
import { draftFromScenario } from "@/lib/domain/scenario";
import { clearDrafts, loadDraft, saveDraft } from "@/lib/draft-storage";
import { useWizardDraft, useWizardNav } from "@/components/wizard/WizardProvider";

export type WorkbenchUrlStatus =
  | { kind: "idle" }
  | { kind: "loading"; target: "run" | "file" }
  | { kind: "missing"; target: "run" | "file" }
  | { kind: "failed"; target: "run" | "file"; error: ApiError | null };

export interface WorkbenchUrl {
  status: WorkbenchUrlStatus;
  /** Reset the draft and clear the URL (the 404 card's action). */
  startFresh: () => void;
}

/** The query string the draft should have: `?run=`, `?file=` or none. */
export function workbenchSearch(state: { exportId: string | null; displayedRun: { runId: string } | null }): string {
  if (state.displayedRun) return `?run=${encodeURIComponent(state.displayedRun.runId)}`;
  if (state.exportId) return `?file=${encodeURIComponent(state.exportId)}`;
  return "";
}

class Missing extends Error {}

/** Loading while the URL names a run or file the draft does not hold; else idle. */
function statusFor(
  runParam: string | null,
  fileParam: string | null,
  draft: { exportId: string | null; displayedRun: { runId: string } | null },
): WorkbenchUrlStatus {
  if (runParam && draft.displayedRun?.runId !== runParam) return { kind: "loading", target: "run" };
  if (fileParam && draft.exportId !== fileParam) return { kind: "loading", target: "file" };
  return { kind: "idle" };
}

export function useWorkbenchUrl(): WorkbenchUrl {
  const router = useRouter();
  const pathname = usePathname() || "/";
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { state, setExport, loadScenario, showRun, clearRun } = useWizardDraft();
  const { reset } = useWizardNav();
  const runParam = params.get("run");
  const fileParam = runParam ? null : params.get("file");
  const current = runParam
    ? `?run=${encodeURIComponent(runParam)}`
    : fileParam
      ? `?file=${encodeURIComponent(fileParam)}`
      : "";

  // What the URL needs, decided during render (never in an effect): loading
  // from the first paint when it names something the draft does not hold
  // yet, so the writer below never "corrects" a URL that is about to be read.
  const [status, setStatus] = useState<WorkbenchUrlStatus>(() => statusFor(runParam, fileParam, state));
  const [seenUrl, setSeenUrl] = useState(current);
  if (seenUrl !== current) {
    setSeenUrl(current);
    setStatus(statusFor(runParam, fileParam, state));
  }
  // A file imported or picked while the URL explained a 404 replaces it.
  const [seenExport, setSeenExport] = useState(state.exportId);
  if (seenExport !== state.exportId) {
    setSeenExport(state.exportId);
    if (status.kind === "missing" || status.kind === "failed") setStatus({ kind: "idle" });
  }

  // The latest draft for the reader, without making the reader depend on it:
  // it must run when the URL changes, not on every keystroke.
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  });
  // Every load gets a ticket; a newer URL makes an older load's result moot.
  const ticket = useRef(0);

  // ---- URL → draft --------------------------------------------------------
  useEffect(() => {
    const draft = latest.current;
    const mine = ++ticket.current;
    const stale = () => mine !== ticket.current;

    async function fetchExport(exportId: string) {
      try {
        return await queryClient.fetchQuery(exportDetailQuery(exportId));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) throw new Missing();
        throw err;
      }
    }

    function fail(target: "run" | "file", err: unknown) {
      if (stale()) return;
      if (err instanceof Missing) setStatus({ kind: "missing", target });
      else if (err instanceof ApiError && err.isUnauthorized) setStatus({ kind: "idle" });
      else setStatus({ kind: "failed", target, error: err instanceof ApiError ? err : null });
    }

    if (runParam) {
      if (draft.displayedRun?.runId === runParam) return;
      void (async () => {
        try {
          const run = await queryClient.fetchQuery(runSummaryQuery(runParam));
          if (!run || !run.export_id) throw new Missing();
          const exp = await fetchExport(run.export_id);
          if (stale()) return;
          setExport(exp.export_id, exp.manifest, exp.rocket_id ?? null, {
            filename: exp.ork_filename ?? run.ork_filename,
            rocketName: exp.name ?? run.name,
          });
          const fromRun = draftFromScenario(run.scenario);
          const stored = loadDraft(exp.export_id);
          loadScenario(
            stored?.runId === run.simulation_id
              ? {
                  ...fromRun,
                  site: stored.site,
                  launchDatetime: stored.launchDatetime,
                  atmosphere: stored.atmosphere,
                  railOverrides: stored.railOverrides,
                }
              : fromRun,
          );
          showRun({
            runId: run.simulation_id,
            exportId: exp.export_id,
            scenario: run.scenario,
            result: {
              run_id: run.simulation_id,
              scalars: run.scalars as Record<string, number>,
              warnings: run.warnings,
              plot_urls: run.plot_names.map((name) => plotUrl(run.simulation_id, name)),
            },
            exportFilename: exp.ork_filename,
            manifest: exp.manifest,
          });
          setStatus({ kind: "idle" });
        } catch (err) {
          fail("run", err);
        }
      })();
      return;
    }

    if (fileParam) {
      if (draft.displayedRun) clearRun();
      if (draft.exportId === fileParam) return;
      void (async () => {
        try {
          const exp = await fetchExport(fileParam);
          if (stale()) return;
          setExport(exp.export_id, exp.manifest, exp.rocket_id ?? null, {
            filename: exp.ork_filename,
            rocketName: exp.name,
          });
          setStatus({ kind: "idle" });
        } catch (err) {
          fail("file", err);
        }
      })();
    }
    // Only a URL change re-reads the URL; the draft is read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runParam, fileParam]);

  // ---- draft → URL --------------------------------------------------------
  // Runs when the wanted URL changes (an edit of the file, a new run), never
  // because the URL itself changed: a link or the back button is read above,
  // not overwritten here.
  const desired = workbenchSearch(state);
  const settled = status.kind === "idle";
  const lastRun = useRef<string | null>(state.displayedRun?.runId ?? runParam);
  useEffect(() => {
    // While the URL is being resolved, or explains a 404, it stays as it is.
    if (!settled || desired === current) return;
    const runId = state.displayedRun?.runId ?? null;
    const newRun = runId !== null && runId !== runParam && runId !== lastRun.current;
    lastRun.current = runId;
    const href = `${pathname}${desired}`;
    if (newRun) router.push(href, { scroll: false });
    else router.replace(href, { scroll: false });
    // `current` and `runParam` describe the URL this effect may replace; the
    // effect itself only needs to run when the wanted URL changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desired, settled]);

  // ---- draft → sessionStorage (S12l) --------------------------------------
  // Only once the URL is settled: while `?run=` resolves the draft is still
  // the empty one the page started with, and saving it would overwrite the
  // edits about to be re-applied.
  const { exportId, site, launchDatetime, atmosphere, railOverrides } = state;
  const baseRunId = state.displayedRun?.runId ?? null;
  useEffect(() => {
    if (!settled || exportId === null) return;
    saveDraft(exportId, { runId: baseRunId, site, launchDatetime, atmosphere, railOverrides });
  }, [settled, exportId, baseRunId, site, launchDatetime, atmosphere, railOverrides]);

  const startFresh = useCallback(() => {
    ticket.current++;
    clearDrafts();
    reset();
    setStatus({ kind: "idle" });
    router.replace(pathname, { scroll: false });
  }, [pathname, reset, router]);

  return { status, startFresh };
}
