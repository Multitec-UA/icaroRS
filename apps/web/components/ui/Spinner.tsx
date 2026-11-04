"use client";

import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";

/**
 * `decorative` hides the spinner from assistive tech. Use it whenever visible
 * loading text sits next to the spinner, otherwise screen readers announce
 * the state twice ("Loading…" from the label plus the text).
 */
export function Spinner({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  if (decorative) return <SpinnerGlyph className={className} />;
  return <LabelledSpinner className={className} />;
}

function LabelledSpinner({ className }: { className?: string }) {
  const t = useT();
  return <SpinnerGlyph className={className} role="status" label={t("common.loading")} />;
}

/** The ring itself; hook-free so decorative spinners render anywhere. */
function SpinnerGlyph({ className, role, label }: { className?: string; role?: "status"; label?: string }) {
  return (
    <span
      {...(role ? { role, "aria-label": label } : { "aria-hidden": true })}
      className={cn(
        "inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent",
        className,
      )}
    />
  );
}
