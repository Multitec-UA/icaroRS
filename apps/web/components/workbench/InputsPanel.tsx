"use client";

/**
 * InputsPanel — the Workbench's left column (S7): Launch site, Time &
 * weather, Launch rail, Uncertainty presets. Each section edits the shared
 * draft in WizardProvider and shows the 422 errors of its own fields inline.
 */

import type { FieldError } from "@/lib/api";
import { useT } from "@/components/i18n/LocaleProvider";
import { LaunchSiteSection } from "./LaunchSiteSection";
import { TimeWeatherSection } from "./TimeWeatherSection";
import { LaunchRailSection } from "./LaunchRailSection";
import { UncertaintySection } from "./UncertaintySection";

export function InputsPanel({ errors }: { errors: FieldError[] }) {
  const t = useT();
  return (
    <aside
      aria-label={t("workbench.inputs")}
      className="flex w-full flex-col gap-6 border-b border-divider p-4 sm:p-5 lg:w-[360px] lg:shrink-0 lg:border-b-0 lg:border-r"
    >
      <LaunchSiteSection errors={errors} />
      <TimeWeatherSection errors={errors} />
      <LaunchRailSection errors={errors} />
      <UncertaintySection />
    </aside>
  );
}
