/**
 * Presentational content for app/global-error.tsx — the boundary that
 * replaces the ENTIRE root layout (LocaleProvider, WizardProvider, AuthGate
 * all unmount) when something fails badly enough to escape it.
 *
 * Deliberately has no dependency on the app's context providers, the shared
 * "@/components/ui" primitives, or Tailwind's `@theme inline` tokens beyond
 * what globals.css defines — global-error.tsx must supply its own styles per
 * the Next.js docs, and this content is what it supplies them to.
 */

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
      className="w-full max-w-sm rounded-2xl bg-rose-500/[0.07] p-6 text-center ring-1 ring-inset ring-rose-400/25"
    >
      {/* The only content on the page, so it is also its heading. */}
      <h1 className="text-sm font-semibold text-balance text-rose-50">{title}</h1>
      <p className="mt-1 text-sm text-rose-50/90">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-medium text-[#050505] outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-cyan-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#050505]"
      >
        {retryLabel}
      </button>
    </div>
  );
}
