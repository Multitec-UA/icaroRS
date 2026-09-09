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

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  getHistory,
  getRockets,
  getResult,
  getSeries,
  getScenarioTemplate,
  simulate,
  type ResultEnvelope,
  type ScenarioTemplate,
  type SimulateResult,
  type SimulationSummary,
  type RocketSummary,
  type FlightSeries,
} from "./api";

export const queryKeys = {
  history: ["history"] as const,
  rockets: ["rockets"] as const,
  result: (runId: string) => ["results", runId] as const,
  series: (runId: string) => ["results", runId, "series"] as const,
  scenarioTemplate: ["scenario", "template"] as const,
};

export function useHistoryQuery() {
  return useQuery<SimulationSummary[]>({
    queryKey: queryKeys.history,
    queryFn: () => getHistory(),
  });
}

export function useRocketsQuery() {
  return useQuery<RocketSummary[]>({
    queryKey: queryKeys.rockets,
    queryFn: () => getRockets(),
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
