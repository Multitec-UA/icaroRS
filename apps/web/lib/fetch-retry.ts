/**
 * Retrying fetches that never reached the API, and describing why a fetch failed.
 *
 * A brand-new web instance on Cloud Run can fail its first outbound
 * connections: for its first seconds its VPC egress is not ready yet. Node
 * tries each resolved address (IPv6 fails with ENETUNREACH, since the VPC has
 * no IPv6 route; IPv4 with ETIMEDOUT) and the request errors in about two
 * seconds without reaching the API. Observed in production on 2026-10-22/23.
 * Repeating the request after a short pause is safe for requests that are
 * safe to repeat.
 *
 * Forcing IPv4 does not help: tried on 2026-10-23, the same first connection
 * then hung for the full 10 s connect timeout instead of failing in 2 s.
 *
 * Shared by the browser client (lib/api.ts) and the server-only client
 * (lib/server-api.ts), so it imports nothing from either.
 */

/** Pause before each retry. Three attempts in total, about three seconds of waiting. */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 2000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    const { code, address } = cause as Error & { code?: unknown; address?: unknown };
    if (typeof code === "string") {
      return typeof address === "string" ? `${code} ${address}` : code;
    }
    return cause.message;
  }
  return String(cause);
}

/**
 * One line naming why a fetch failed: its message, then each underlying
 * connection error with its code and address. Node wraps the real reason in
 * `cause`, often an AggregateError holding one error per address it tried,
 * and prints it across many lines that Cloud Logging stores as separate
 * entries.
 */
export function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: unknown }).cause;
  if (cause === undefined) return err.message;
  const parts =
    cause instanceof AggregateError ? cause.errors.map(describeCause) : [describeCause(cause)];
  return `${err.message}: ${parts.join("; ")}`;
}

export interface RetryOptions {
  /** Pause before each retry; its length is the number of retries. Empty means no retry. */
  delaysMs: readonly number[];
  /** A response that means the request never reached its target, so it is worth repeating. */
  isTransientResponse?: (res: Response) => boolean;
  /** Called before each retry with its 1-based number and why the attempt failed. */
  onRetry?: (retry: number, reason: string) => void;
}

/**
 * `fetch`, repeated while it rejects or returns a transient response, pausing
 * `delaysMs[i]` before retry i. Returns the last response, or rethrows the
 * last error, once the delays are exhausted.
 */
export async function fetchRetrying(
  input: string,
  init: RequestInit,
  { delaysMs, isTransientResponse, onRetry }: RetryOptions,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const canRetry = attempt < delaysMs.length;
    let reason: string;
    try {
      const res = await fetch(input, init);
      if (!canRetry || !isTransientResponse?.(res)) return res;
      reason = `HTTP ${res.status}`;
    } catch (err) {
      if (!canRetry) throw err;
      reason = describeFetchError(err);
    }
    onRetry?.(attempt + 1, reason);
    await sleep(delaysMs[attempt]);
  }
}
