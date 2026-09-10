/**
 * The server-state layer (issue #48).
 *
 * A single TanStack Query `QueryClient` backs every `useQuery` / `useMutation`
 * call in the app. Two things live here instead of being repeated per
 * consumer:
 *
 * 1. Defaults — `retry: false` everywhere. The old hand-rolled effects never
 *    retried either; adding retries as a side effect of this migration would
 *    change behavior (and make error-path tests flaky) without anyone asking
 *    for it. `refetchOnWindowFocus` stays off for the same reason — nothing
 *    about tab-focus should silently invalidate a wizard draft.
 *
 * 2. Centralized 401 handling — every consumer used to repeat
 *    `if (err instanceof ApiError && err.isUnauthorized) logout()`. That
 *    check now lives once, in `queryCache`/`mutationCache` `onError`, and
 *    fires for ANY query or mutation run through this client. `AuthGate`
 *    registers its `logout` via `setUnauthorizedHandler` so this module
 *    never has to import React or the auth context.
 */

import { QueryClient, QueryCache, MutationCache } from "@tanstack/react-query";
import { ApiError } from "./api";

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

/**
 * Called by `AuthGate` (which owns `logout`) so a 401 from any query or
 * mutation drops the user back to the login screen. Pass `null` to
 * unregister (e.g. on unmount) so a stale handler never fires.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

function handleQueryOrMutationError(error: unknown): void {
  if (error instanceof ApiError && error.isUnauthorized) {
    unauthorizedHandler?.();
  }
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
    queryCache: new QueryCache({ onError: handleQueryOrMutationError }),
    mutationCache: new MutationCache({ onError: handleQueryOrMutationError }),
  });
}

// Next.js App Router renders client components on the server too (for the
// initial HTML). A module-level singleton there would be shared across every
// request served by that process, so the server always gets a fresh client;
// only the browser reuses one for the lifetime of the tab, which is what
// makes caching/dedup actually do anything. See TanStack Query's documented
// Next.js App Router pattern.
let browserQueryClient: QueryClient | undefined;

export function getQueryClient(): QueryClient {
  if (typeof window === "undefined") {
    return makeQueryClient();
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}
