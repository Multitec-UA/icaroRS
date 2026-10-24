"use client";

/**
 * One query key + hook per API endpoint (issue #48). Every read that used to
 * be a hand-rolled `useEffect` + `active` flag + loading/error/data triple is
 * a `useQuery` call defined here; the two write flows that share the same
 * underlying endpoint (the wizard's "Run simulation" and history's "Re-run")
 * share the one `useSimulateMutation`.
 *
 * 401 handling is NOT done here — see lib/query-client.ts. Every hook below
 * throws through the shared QueryClient, so a 401 from any of them logs the
 * user out in one place instead of each consumer repeating the check.
 */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  convert,
  getHistory,
  getRunSummary,
  getRockets,
  getExport,
  getRocket,
  getResult,
  getSeries,
  getScenarioTemplate,
  simulate,
  type ResultEnvelope,
  type ConvertResponse,
  type ExportDetail,
  type RocketDetail,
  type ScenarioTemplate,
  type SimulateResult,
  type SimulationSummary,
  type RocketSummary,
  type FlightSeries,
} from "./api";

export const queryKeys = {
  /** Prefix of every history list; invalidating it refreshes all of them. */
  history: ["history"] as const,
  /** One page of runs: the whole org's (`null`) or one rocket's. */
  historyList: (rocketId: string | null, limit: number) => ["history", rocketId ?? "all", limit] as const,
  /** One run's summary row (the run report's metadata). */
  run: (runId: string) => ["history", "run", runId] as const,
  rockets: ["rockets"] as const,
  /** One rocket with its exports. Shares the `rockets` prefix so one invalidation refreshes list and details. */
  rocket: (rocketId: string) => ["rockets", rocketId] as const,
  result: (runId: string) => ["results", runId] as const,
  series: (runId: string) => ["results", runId, "series"] as const,
  scenarioTemplate: ["scenario", "template"] as const,
};

/**
 * GET /api/history, newest first. `rocketId` narrows it to one rocket's runs
 * (the /runs page); `enabled: false` keeps a list idle until its inputs are
 * known (for example the rocket to default to).
 */
export function useHistoryQuery(options?: { rocketId?: string | null; limit?: number; enabled?: boolean }) {
  const rocketId = options?.rocketId ?? null;
  const limit = options?.limit ?? 20;
  return useQuery<SimulationSummary[]>({
    queryKey: queryKeys.historyList(rocketId, limit),
    queryFn: () => getHistory(limit, undefined, rocketId),
    enabled: options?.enabled ?? true,
  });
}

/**
 * GET /api/history/{runId} — the run's summary row (rocket name, file,
 * author, scenario) for the run report. `GET /api/results/{run_id}` carries
 * only the numbers, so the report asks for its row separately; a 404 (a run
 * that is not the org's, or was deleted) resolves to `null` and the report
 * shows what it has without a name instead of erroring.
 */
export function useRunSummaryQuery(runId: string) {
  return useQuery<SimulationSummary | null>({
    queryKey: queryKeys.run(runId),
    queryFn: async () => {
      try {
        return await getRunSummary(runId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

export function useRocketsQuery() {
  return useQuery<RocketSummary[]>({
    queryKey: queryKeys.rockets,
    queryFn: () => getRockets(),
  });
}

/**
 * GET /api/rockets/{rocketId} — the rocket and its exports, newest first
 * (the Workbench's rocket panel, S8/A3). `null` means "no rocket yet": the
 * query stays idle instead of asking for a rocket that does not exist.
 */
export function useRocketDetailQuery(rocketId: string | null) {
  return useQuery<RocketDetail>({
    queryKey: queryKeys.rocket(rocketId ?? "none"),
    queryFn: () => getRocket(rocketId as string),
    enabled: rocketId !== null,
  });
}

/**
 * `enabled: false` short-circuits the fetch entirely — used when the caller
 * already has the result in hand (e.g. the wizard just produced it) and a
 * network round-trip would only refetch what's already on screen.
 */
export function useResultQuery(runId: string, options?: { enabled?: boolean }) {
  return useQuery<ResultEnvelope>({
    queryKey: queryKeys.result(runId),
    queryFn: () => getResult(runId),
    enabled: options?.enabled ?? true,
  });
}

/** 404 (a run that predates this feature) is a normal, permanent "no series". */
export function useSeriesQuery(runId: string) {
  return useQuery<FlightSeries>({
    queryKey: queryKeys.series(runId),
    queryFn: () => getSeries(runId),
  });
}

/**
 * The series of several runs at once (the /runs overlay). Same key and fetch
 * as useSeriesQuery, so a run already opened elsewhere costs no new request
 * and a 404 means "no series" exactly as it does there. Results come back in
 * the order of `runIds`.
 */
export function useSeriesQueries(runIds: string[]) {
  return useQueries({
    queries: runIds.map((runId) => ({
      queryKey: queryKeys.series(runId),
      queryFn: () => getSeries(runId),
    })),
  });
}

export function useScenarioTemplateQuery() {
  return useQuery<ScenarioTemplate>({
    queryKey: queryKeys.scenarioTemplate,
    queryFn: getScenarioTemplate,
  });
}

/** POST /api/simulate — shared by the wizard's initial run and history's re-run. */
export function useSimulateMutation() {
  return useMutation<SimulateResult, unknown, { exportId: string; scenario: unknown }>({
    mutationFn: ({ exportId, scenario }) => simulate(exportId, scenario),
  });
}

/**
 * POST /api/convert — the Workbench's `.ork` import (S8). `rocketId` is the
 * destination the user chose explicitly (L14): `null` creates a new rocket,
 * an id attaches the export to that rocket. A successful convert changes
 * the org's rockets and the destination rocket's exports, so both the list
 * and every detail query (same `rockets` key prefix) are invalidated here,
 * once, for every caller.
 */
export function useConvertMutation() {
  const queryClient = useQueryClient();
  return useMutation<ConvertResponse, unknown, { file: File; rocketId: string | null }>({
    mutationFn: ({ file, rocketId }) => convert(file, rocketId ?? undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.rockets }),
  });
}

/**
 * GET /api/exports/{exportId} on demand — switching the active file inside
 * the rocket panel. A mutation rather than a query because the fetch is an
 * action with its own pending/error state, not data the screen keeps.
 */
export function useExportDetailMutation() {
  return useMutation<ExportDetail, unknown, string>({
    mutationFn: (exportId) => getExport(exportId),
  });
}

/**
 * "Use this rocket" (issue #50): GET /api/rockets/{rocketId} for the rocket's
 * exports, then GET /api/exports/{exportId} of the newest one for its
 * manifest. A rocket with no exports yet rejects with an ApiError(404) so the
 * card shows its inline error instead of silently doing nothing. Going
 * through useMutation gives loading + error state plus the shared 401
 * handling every other call in this file already gets.
 */
export function useRocketLatestExportMutation() {
  return useMutation<{ rocket: RocketDetail; export: ExportDetail }, unknown, string>({
    mutationFn: async (rocketId) => {
      const rocket = await getRocket(rocketId);
      const newest = rocket.exports[0];
      if (!newest) {
        throw new ApiError(404, `Rocket '${rocketId}' has no exports yet.`, {
          code: "requestFailed",
        });
      }
      return { rocket, export: await getExport(newest.export_id) };
    },
  });
}
