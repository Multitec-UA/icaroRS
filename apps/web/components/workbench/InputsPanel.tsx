"use client";

/**
 * InputsPanel — the Workbench's left column: Launch site, Time & weather and
 * Launch rail. Each section edits the shared draft in WizardProvider and
 * shows the 422 errors of its own fields inline.
 *
 * Every input stays editable the whole time, also while a file converts;
 * only the rail fields wait for a file, because their values come from it
 * (LaunchRailSection disables them with a "From your .ork" placeholder).
 */

import type { FieldError } from "@/lib/api";
import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { LaunchSiteSection } from "./LaunchSiteSection";
import { TimeWeatherSection } from "./TimeWeatherSection";
import { LaunchRailSection } from "./LaunchRailSection";

/**
 * `hidden` is the phone tab state (S10): it hides the column below lg only
 * (CSS, never unmounting it), so both columns always show on desktop.
 */
export function InputsPanel({ id, hidden = false, errors }: { id?: string; hidden?: boolean; errors: FieldError[] }) {
  const t = useT();

  return (
    <aside
      id={id}
      aria-label={t("workbench.inputs")}
      className={cn(
        "flex w-full flex-col gap-6 p-4 sm:p-5 lg:w-[360px] lg:shrink-0 lg:border-r lg:border-divider",
        hidden && "max-lg:hidden",
      )}
    >
      <LaunchSiteSection errors={errors} />
      <TimeWeatherSection errors={errors} />
      <LaunchRailSection errors={errors} />
    </aside>
  );
}
