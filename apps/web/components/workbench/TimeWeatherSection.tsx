"use client";

/**
 * Time & weather — launch date/hour plus the atmosphere model.
 *
 * Typing a date asks the API which model fits it (GET /api/atmosphere/suggest:
 * a real GFS forecast when the date is within range, else the standard
 * atmosphere) and applies it; the segmented control lets the user override.
 * Forecast and sounding models need a date (`needsDate`), and the Run button
 * stays disabled until one is typed — the hint under the field says so.
 *
 * The model choice is forecast / standard / sounding only: `reanalysis`
 * reads a server-side file path, never user input (S4). "If the forecast is
 * unavailable" exposes `atmosphere.fallback`; the core sets the fallback
 * model and always records a warning on the result when it is used
 * (packages/icaro/icaro/simulation.py). The API passes the value straight to
 * the atmosphere model, so the standard atmosphere is the only fallback it
 * accepts — there is no "fail the run" value to offer.
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
import { cn, selectClass } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { errorFor } from "./fieldErrors";
import { Section } from "./Section";

const MODEL_OPTIONS: ReadonlyArray<{ value: AtmosphereModel; labelKey: `workbench.model${string}` }> = [
  { value: "forecast", labelKey: "workbench.modelForecast" },
  { value: "standard_atmosphere", labelKey: "workbench.modelStandard" },
  { value: "wyoming_sounding", labelKey: "workbench.modelSounding" },
];

/** Fallback models the API accepts for `atmosphere.fallback`. */
const FALLBACK_OPTIONS: ReadonlyArray<{ value: string; labelKey: "workbench.fallbackStandard" }> = [
  { value: "standard_atmosphere", labelKey: "workbench.fallbackStandard" },
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
      <Field
        label={t("workbench.fallbackLabel")}
        htmlFor="fallback"
        hint={t("workbench.fallbackHint")}
        error={errorFor(errors, "atmosphere.fallback")}
      >
        <select
          id="fallback"
          name="atmosphere-fallback"
          className={cn(selectClass, "h-9")}
          value={state.atmosphere.fallback}
          onChange={(e) => setAtmosphere({ ...state.atmosphere, fallback: e.target.value })}
        >
          {FALLBACK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </Field>

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
