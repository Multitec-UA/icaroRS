"use client";

/**
 * One query key + hook per API endpoint (issue #48). Every read that used to
 * be a hand-rolled `useEffect` + `active` flag + loading/error/data triple is
 * a `useQuery` call defined here.
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
  getSeries,
  getMonteCarlo,
  listMonteCarlo,
  renameRocket,
  simulate,
  submitMonteCarlo,
  recommendRail,
  type LaunchDayRequest,
  type LaunchDayResult,
  type MonteCarloRequest,
  type MonteCarloRun,
  type MonteCarloSubmitted,
  type MonteCarloSummary,
  type ConvertResponse,
  type ExportDetail,
  type ExportSummary,
  type RocketDetail,
  type SimulateResult,
  type SimulationSummary,
  type RocketSummary,
  type FlightSeries,
} from "./api";
import { isMonteCarloActive, monteCarloPollInterval } from "./domain/montecarlo";

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
  /** One export with its manifest. Exports are immutable once converted. */
  export: (exportId: string) => ["exports", exportId] as const,
  /** Prefix of every Monte Carlo query; invalidating it refreshes lists and runs. */
  monteCarlo: ["montecarlo"] as const,
  monteCarloRun: (runId: string) => ["montecarlo", "run", runId] as const,
  monteCarloList: (rocketId: string | null) => ["montecarlo", "list", rocketId ?? "all"] as const,
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
  return useQuery(runSummaryQuery(runId));
}

/**
 * The run summary query's key and fetch, shared by useRunSummaryQuery and
 * the Workbench's URL loader (`queryClient.fetchQuery`, S8), so both read
 * one cache entry with one meaning: `null` is a 404.
 */
export function runSummaryQuery(runId: string) {
  return {
    queryKey: queryKeys.run(runId),
    queryFn: async (): Promise<SimulationSummary | null> => {
      try {
        return await getRunSummary(runId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  };
}

/** GET /api/exports/{exportId}: key and fetch shared by useExportDetailQuery and the URL loader. */
export function exportDetailQuery(exportId: string) {
  return {
    queryKey: queryKeys.export(exportId),
    queryFn: () => getExport(exportId),
    staleTime: Infinity,
  };
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
/** GET /api/rockets/{rocketId} as query options, for `fetchQuery` outside a component. */
export function rocketDetailQuery(rocketId: string) {
  return { queryKey: queryKeys.rocket(rocketId), queryFn: () => getRocket(rocketId) };
}

export function useRocketDetailQuery(rocketId: string | null) {
  return useQuery<RocketDetail>({
    ...rocketDetailQuery(rocketId ?? "none"),
    enabled: rocketId !== null,
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

/**
 * GET /api/exports/{exportId} as data the screen keeps: the rocket panel's
 * compact card of each file reads its manifest. A converted export never
 * changes, so the result stays fresh for the whole session.
 */
export function useExportDetailQuery(exportId: string, options?: { enabled?: boolean }) {
  return useQuery<ExportDetail>({ ...exportDetailQuery(exportId), enabled: options?.enabled ?? true });
}

/** POST /api/simulate — the Workbench's Run. */
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
 * PATCH /api/rockets/{rocketId} — rename from the /rockets card. Every view
 * that shows the name reads it from the rocket list/detail or the run
 * summaries (which denormalize it live), so both prefixes are invalidated.
 */
export function useRenameRocketMutation() {
  const queryClient = useQueryClient();
  return useMutation<RocketSummary, unknown, { rocketId: string; name: string }>({
    mutationFn: ({ rocketId, name }) => renameRocket(rocketId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.rockets });
      void queryClient.invalidateQueries({ queryKey: queryKeys.history });
    },
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
 * The newest export of a rocket: GET /api/rockets/{rocketId} (exports come
 * newest first). A rocket with no exports yet rejects with an ApiError(404)
 * so the caller shows its inline error instead of silently doing nothing.
 */
async function newestExport(rocketId: string): Promise<{ rocket: RocketDetail; newest: ExportSummary }> {
  const rocket = await getRocket(rocketId);
  const newest = rocket.exports[0];
  if (!newest) {
    throw new ApiError(404, `Rocket '${rocketId}' has no exports yet.`, { code: "requestFailed" });
  }
  return { rocket, newest };
}

/**
 * "Use this rocket" on /rockets (S8): only the newest export's id, since
 * the card navigates to `/?file={id}` and the Workbench loads the file from
 * its URL. Going through useMutation gives loading + error state plus the
 * shared 401 handling every other call in this file already gets.
 */
export function useRocketNewestExportMutation() {
  return useMutation<ExportSummary, unknown, string>({
    mutationFn: async (rocketId) => (await newestExport(rocketId)).newest,
  });
}

/**
 * Switching rocket inside the Workbench's rocket panel: the newest export
 * of the rocket with its manifest (GET /api/exports/{exportId}), loaded
 * into the draft on the spot.
 */
export function useRocketLatestExportMutation() {
  return useMutation<{ rocket: RocketDetail; export: ExportDetail }, unknown, string>({
    mutationFn: async (rocketId) => {
      const { rocket, newest } = await newestExport(rocketId);
      return { rocket, export: await getExport(newest.export_id) };
    },
  });
}

/**
 * GET /api/montecarlo/{runId} (S12): polled every ~2 s while the run is
 * `queued` or `running`, never again once it is `done` or `error`, nor after
 * a failed poll (fetches already retry transient failures). `null` keeps it idle.
 * `initialData` seeds it with a run read on the server (/results/mc/{id}).
 */
export function useMonteCarloQuery(runId: string | null, options?: { initialData?: MonteCarloRun }) {
  return useQuery<MonteCarloRun>({
    queryKey: queryKeys.monteCarloRun(runId ?? "none"),
    queryFn: () => getMonteCarlo(runId as string),
    enabled: runId !== null,
    // A run the server already read (the dispersion report) is shown as is:
    // refetched only while it can still change.
    ...(options?.initialData && {
      initialData: options.initialData,
      staleTime: (query) => (isMonteCarloActive(query.state.data?.status) ? 0 : Infinity),
    }),
    refetchInterval: (query) =>
      query.state.status === "error" ? false : monteCarloPollInterval(query.state.data?.status),
  });
}

/**
 * GET /api/montecarlo?rocket_id= — one rocket's Monte Carlo runs on /runs,
 * newest first. Polled like a single run while any of them is still active,
 * so statuses move without a reload.
 */
export function useMonteCarloListQuery(rocketId: string | null, options?: { enabled?: boolean }) {
  return useQuery<MonteCarloSummary[]>({
    queryKey: queryKeys.monteCarloList(rocketId),
    queryFn: () => listMonteCarlo(rocketId),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) =>
      query.state.status !== "error" && query.state.data?.some((run) => isMonteCarloActive(run.status))
        ? monteCarloPollInterval("running")
        : false,
  });
}

/** POST /api/montecarlo — queue a dispersion run; the lists refresh on success. */
export function useSubmitMonteCarloMutation() {
  const queryClient = useQueryClient();
  return useMutation<MonteCarloSubmitted, unknown, MonteCarloRequest>({
    mutationFn: (body) => submitMonteCarlo(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.monteCarlo }),
  });
}

/**
 * POST /api/launchday — the launch-day rail recommendation (S6b). Synchronous
 * (1–2 min) and never retried (mutations default to `retry: false`).
 */
export function useRecommendRailMutation() {
  return useMutation<LaunchDayResult, unknown, LaunchDayRequest>({
    mutationFn: (body) => recommendRail(body),
  });
}

/**
 * Several finished Monte Carlo runs at once (the /runs dispersion table's
 * median apogee): same key and fetch as useMonteCarloQuery, so a run already
 * opened costs no new request. Results come back in the order of `runIds`.
 */
export function useMonteCarloRunQueries(runIds: string[]) {
  return useQueries({
    queries: runIds.map((runId) => ({
      queryKey: queryKeys.monteCarloRun(runId),
      queryFn: () => getMonteCarlo(runId),
      staleTime: Infinity,
    })),
  });
}
