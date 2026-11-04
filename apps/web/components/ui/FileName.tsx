/**
 * A converted file's name with its import version (`v3`) as a pill when the
 * same file name was imported more than once into its rocket (see
 * lib/domain/exports.ts). File names are identifiers: never machine-translated.
 */

import { cn } from "@/lib/styles";

export function FileName({
  name,
  revision,
  className,
}: {
  name: string;
  revision?: number | null;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex min-w-0 max-w-full items-baseline gap-1.5", className)}>
      <span translate="no" className="truncate">
        {name}
      </span>
      {/* A real space, so assistive tech reads "file.ork v3"; flex layout ignores it. */}
      {typeof revision === "number" && " "}
      {typeof revision === "number" && (
        <span
          translate="no"
          className="shrink-0 rounded-full bg-chip px-1.5 py-px font-sans text-[11px] font-medium tabular-nums text-ink-2"
        >
          {`v${revision}`}
        </span>
      )}
    </span>
  );
}
