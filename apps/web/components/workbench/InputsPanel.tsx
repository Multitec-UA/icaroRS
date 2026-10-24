"use client";

/**
 * InputsPanel — the Workbench's left column (S7/S8): Launch site, Time &
 * weather, Launch rail, Uncertainty presets. Each section edits the shared
 * draft in WizardProvider and shows the 422 errors of its own fields inline.
 *
 * Launch rail and Uncertainty take their defaults from the `.ork`, so until
 * an export is active they sit in a disabled fieldset with a note saying so
 * (S8/A1); Launch site and Time & weather stay editable the whole time, also
 * while a file converts.
 */

import { useId } from "react";
import type { FieldError } from "@/lib/api";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/styles";
import { InfoIcon } from "./icons";
import { LaunchSiteSection } from "./LaunchSiteSection";
import { TimeWeatherSection } from "./TimeWeatherSection";
import { LaunchRailSection } from "./LaunchRailSection";
import { UncertaintySection } from "./UncertaintySection";

export function InputsPanel({ errors }: { errors: FieldError[] }) {
  const t = useT();
  const { state } = useWizardDraft();
  const noteId = useId();
  const hasExport = state.exportId !== null;

  return (
    <aside
      aria-label={t("workbench.inputs")}
      className="flex w-full flex-col gap-6 border-b border-divider p-4 sm:p-5 lg:w-[360px] lg:shrink-0 lg:border-b-0 lg:border-r"
    >
      <LaunchSiteSection errors={errors} />
      <TimeWeatherSection errors={errors} />
      <fieldset
        disabled={!hasExport}
        aria-describedby={hasExport ? undefined : noteId}
        className={cn(
          "flex min-w-0 flex-col gap-6 transition-opacity duration-300 ease-[var(--ease-spring)]",
          !hasExport && "opacity-60",
        )}
      >
        {!hasExport && (
          <p
            id={noteId}
            className="-mb-2 flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink-2"
          >
            <InfoIcon className="shrink-0 text-muted" />
            {t("workbench.inputsNeedExport")}
          </p>
        )}
        <LaunchRailSection errors={errors} />
        <UncertaintySection />
      </fieldset>
    </aside>
  );
}
