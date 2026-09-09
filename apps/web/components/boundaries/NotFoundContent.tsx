/**
 * Presentational content for app/not-found.tsx. `/results/[runId]` is a
 * deep-linkable, shareable route, so a stale or mistyped URL is a realistic
 * entry point, not just a typo'd nav link.
 *
 * Framework-server-safe (no hooks, no context): app/not-found.tsx is an
 * async Server Component and resolves the locale itself, passing already-
 * translated strings in as props.
 */

import Link from "next/link";

export function NotFoundContent({
  title,
  message,
  backLabel,
}: {
  title: string;
  message: string;
  backLabel: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">404</p>
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="max-w-sm text-sm text-muted">{message}</p>
      <Link
        href="/"
        className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-foreground px-6 text-sm font-medium text-[#050505] transition-opacity hover:opacity-90"
      >
        {backLabel}
      </Link>
    </div>
  );
}
