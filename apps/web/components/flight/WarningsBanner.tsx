"use client";

/**
 * WarningsBanner — the run's warnings above the KPIs (S9), warn-toned.
 * API warnings are English verbatim (RG-6.1), hence the note. Past two
 * warnings the list collapses behind "Show all N warnings".
 */

import { useState } from "react";
import { cn, focusRing } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { WarningIcon } from "@/components/workbench/icons";

const COLLAPSED_COUNT = 2;

export function WarningsBanner({ warnings }: { warnings: string[] }) {
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const collapsible = warnings.length > COLLAPSED_COUNT;
  const shown = collapsible && !expanded ? warnings.slice(0, COLLAPSED_COUNT) : warnings;

  if (warnings.length === 0) return null;

  return (
    <div
      role="status"
      className="flex gap-2.5 rounded-xl bg-warn-soft px-3.5 py-2.5 text-[13px] text-warn-ink"
    >
      <WarningIcon className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{t("results.warningsTitle")}</p>
        <ul className="flex flex-col gap-0.5">
          {shown.map((warning, i) => (
            <li key={i} className="break-words">
              {warning}
            </li>
          ))}
        </ul>
        {collapsible && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
            className={cn("self-start rounded text-xs font-medium underline underline-offset-2", focusRing)}
          >
            {expanded ? t("flight.warningsShowLess") : t("flight.warningsShowAll", { count: warnings.length })}
          </button>
        )}
        <p className="text-xs opacity-75">{t("common.technicalEnglishNote")}</p>
      </div>
    </div>
  );
}
