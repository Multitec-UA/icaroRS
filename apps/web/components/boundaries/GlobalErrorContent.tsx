/**
 * Presentational content for app/global-error.tsx — the boundary that
 * replaces the ENTIRE root layout (LocaleProvider, WizardProvider, AuthGate
 * all unmount) when something fails badly enough to escape it.
 *
 * Deliberately has no dependency on the app's context providers or the
 * kit's React primitives — only the kit's plain class strings and the tokens
 * globals.css defines (global-error.tsx imports it, per the Next.js docs).
 */

import { buttonClass } from "@/components/ui/classes";

export function GlobalErrorContent({
  title,
  message,
  retryLabel,
  onRetry,
}: {
  title: string;
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="w-full max-w-sm rounded-[14px] border border-border bg-bad-soft p-6 text-center"
    >
      {/* The only content on the page, so it is also its heading. */}
      <h1 className="text-sm font-semibold text-balance text-bad-ink">{title}</h1>
      <p className="mt-1 text-sm text-bad-ink">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className={buttonClass({ variant: "primary", className: "mt-4" })}
      >
        {retryLabel}
      </button>
    </div>
  );
}
