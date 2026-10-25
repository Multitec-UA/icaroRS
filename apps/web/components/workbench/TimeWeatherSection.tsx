"use client";

/**
 * Time & weather — launch date/hour plus the atmosphere model.
 *
 * Typing a date asks the API which model fits it (GET /api/atmosphere/suggest:
 * a real GFS forecast when the date is within range, else the standard
 * atmosphere) and applies it; the segmented control lets the user override.
 * Forecast and sounding models need a date (`needsDate`), and the Run button
 * stays disabled until one is typed — the hint under the field says so.
 */

import { useState } from "react";
import {
  ApiError,
  suggestAtmosphere,
  type AtmosphereModel,
  type AtmosphereSuggestion,
  type FieldError,
} from "@/lib/api";
import { launchDateToIso, needsDate, resolveTimeZone, toLaunchDate } from "@/lib/domain/scenario";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { Callout, Field, InfoTip, SegmentedControl, TextInput } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { errorFor } from "./fieldErrors";
import { Section } from "./Section";

const MODEL_OPTIONS: ReadonlyArray<{ value: AtmosphereModel; labelKey: `workbench.model${string}` }> = [
  { value: "forecast", labelKey: "workbench.modelForecast" },
  { value: "standard_atmosphere", labelKey: "workbench.modelStandard" },
  { value: "wyoming_sounding", labelKey: "workbench.modelSounding" },
  { value: "reanalysis", labelKey: "workbench.modelReanalysis" },
];

export function TimeWeatherSection({ errors }: { errors: FieldError[] }) {
  const t = useT();
  const { state, setLaunchDatetime, setAtmosphere } = useWizardDraft();
  const { logout } = useAuth();
  const [suggestion, setSuggestion] = useState<AtmosphereSuggestion | null>(null);

  const model = state.atmosphere.model;
  const missingDate = needsDate(model) && toLaunchDate(state.launchDatetime) === null;

  async function onDateChange(value: string) {
    setLaunchDatetime(value || null);
    // The picker holds the user's wall clock; the API reasons in UTC.
    const launchDate = toLaunchDate(value || null);
    if (!launchDate) {
      setSuggestion(null);
      return;
    }
    try {
      const s = await suggestAtmosphere(launchDateToIso(launchDate));
      setSuggestion(s);
      setAtmosphere({ ...state.atmosphere, model: s.model });
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) return logout();
      setSuggestion(null);
    }
  }

  function chooseModel(next: AtmosphereModel) {
    // A manual choice supersedes the suggestion; keep them from disagreeing.
    setSuggestion(null);
    setAtmosphere({ ...state.atmosphere, model: next });
  }

  return (
    <Section title={t("workbench.timeWeather")} index={1}>
      <Field
        label={t("workbench.launchTime", { timeZone: resolveTimeZone() })}
        htmlFor="dt"
        term="forecast"
        error={errorFor(errors, "date")}
        hint={missingDate ? t("workbench.needsDate") : t("workbench.launchTimeHint")}
      >
        <TextInput
          id="dt"
          name="launch-datetime"
          autoComplete="off"
          type="datetime-local"
          // The domain LaunchDate is hour-granular: step=3600s keeps the
          // picker on whole hours so it never invites a precision the
          // simulation would silently drop.
          step={3600}
          className="h-9"
          value={state.launchDatetime ?? ""}
          onChange={(e) => onDateChange(e.target.value)}
        />
      </Field>

      <SegmentedControl
        label={t("workbench.atmosphereModel")}
        options={MODEL_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
        value={model}
        onChange={chooseModel}
      />
      {errorFor(errors, "atmosphere.model") && (
        <p role="alert" className="text-xs font-medium text-bad-ink">
          {errorFor(errors, "atmosphere.model")}
        </p>
      )}

      {model === "wyoming_sounding" && (
        <Field
          label={t("advanced.fieldStationId")}
          htmlFor="station"
          hint={t("advanced.fieldStationHint")}
          error={errorFor(errors, "atmosphere.station")}
        >
          <TextInput
            id="station"
            name="station"
            autoComplete="off"
            spellCheck={false}
            className="h-9"
            placeholder={t("advanced.stationPlaceholder")}
            value={state.atmosphere.station ?? ""}
            onChange={(e) => setAtmosphere({ ...state.atmosphere, station: e.target.value || null })}
          />
        </Field>
      )}
      {model === "reanalysis" && (
        <Field
          label={t("advanced.fieldEra5Path")}
          htmlFor="file"
          hint={t("advanced.fieldEra5Hint")}
          error={errorFor(errors, "atmosphere.file")}
        >
          <TextInput
            id="file"
            name="era5-file"
            autoComplete="off"
            spellCheck={false}
            className="h-9"
            placeholder={t("advanced.era5Placeholder")}
            value={state.atmosphere.file ?? ""}
            onChange={(e) => setAtmosphere({ ...state.atmosphere, file: e.target.value || null })}
          />
        </Field>
      )}

      {suggestion && (
        <Callout tone={suggestion.needs_internet ? "success" : "info"}>
          <div className="flex items-center gap-1.5">
            <strong>{t(`models.${suggestion.model}`)}</strong>
            <InfoTip term={suggestion.model === "forecast" ? "forecast" : "standard_atmosphere"} />
          </div>
          {/* suggestion.reason is API-originated English — rendered verbatim per RG-6.1/6.2 */}
          <p className="mt-0.5">{suggestion.reason}</p>
          <p className="mt-1 text-xs opacity-75">{t("common.technicalEnglishNote")}</p>
        </Callout>
      )}
    </Section>
  );
}
