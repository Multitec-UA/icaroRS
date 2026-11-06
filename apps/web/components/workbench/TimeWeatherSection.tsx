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
 * reads a server-side file path, never user input (S4). The fallback is a
 * sentence, not a control (S12c): the API passes `atmosphere.fallback`
 * straight to the atmosphere model, so the standard atmosphere is the only
 * value it accepts, and the core always records a warning on the result when
 * it is used (packages/icaro/icaro/simulation.py). The body still sends
 * `fallback: "standard_atmosphere"`.
 *
 * With the Forecast model, a launch hour more than 16 days ahead or already
 * over shows a notice under the date before running (S12e,
 * `outsideForecastWindow`): the run would fall back.
 *
 * Wind on the pad (launch-day S6a): a switch between the atmosphere model's
 * wind and the wind measured on the pad, typed in km/h (0–60) and the
 * direction it comes FROM (0–359°, with its compass point). The draft keeps
 * km/h; `buildScenarioBody` sends `wind: {speed (m/s), direction_from}` to
 * /simulate, /montecarlo and /launchday, and nothing while the switch is off.
 */

import { useState } from "react";
import { DIRECTION_MAX, WIND_MAX_KMH, compassPoint } from "@/lib/domain/launchday";
import {
  ApiError,
  suggestAtmosphere,
  type AtmosphereModel,
  type AtmosphereSuggestion,
  type FieldError,
} from "@/lib/api";
import {
  launchDateToIso,
  needsDate,
  outsideForecastWindow,
  resolveTimeZone,
  toLaunchDate,
} from "@/lib/domain/scenario";
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
];

type WindMode = "forecast" | "manual";

/** Calm, from the north: what the inputs show when the switch is turned on. */
const CALM = { speedKmh: 0, directionFrom: 0 };

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

export function TimeWeatherSection({ errors }: { errors: FieldError[] }) {
  const t = useT();
  const { state, setLaunchDatetime, setAtmosphere, setWind } = useWizardDraft();
  const wind = state.wind;
  const { logout } = useAuth();
  const [suggestion, setSuggestion] = useState<AtmosphereSuggestion | null>(null);

  const model = state.atmosphere.model;
  const missingDate = needsDate(model) && toLaunchDate(state.launchDatetime) === null;
  const outsideWindow = model === "forecast" && outsideForecastWindow(state.launchDatetime);

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
      {outsideWindow && <p className="-mt-1 text-xs font-medium text-warn-ink">{t("workbench.forecastWindowNotice")}</p>}

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
          label={t("workbench.fieldStationId")}
          htmlFor="station"
          hint={t("workbench.fieldStationHint")}
          error={errorFor(errors, "atmosphere.station")}
        >
          <TextInput
            id="station"
            name="station"
            autoComplete="off"
            spellCheck={false}
            className="h-9"
            placeholder={t("workbench.stationPlaceholder")}
            value={state.atmosphere.station ?? ""}
            onChange={(e) => setAtmosphere({ ...state.atmosphere, station: e.target.value || null })}
          />
        </Field>
      )}
      <p className="text-xs text-muted">{t("workbench.fallbackSentence")}</p>
      {errorFor(errors, "atmosphere.fallback") && (
        <p role="alert" className="text-xs font-medium text-bad-ink">
          {errorFor(errors, "atmosphere.fallback")}
        </p>
      )}

      <SegmentedControl<WindMode>
        label={t("workbench.windMode")}
        options={[
          { value: "forecast", label: t("workbench.windForecast") },
          { value: "manual", label: t("workbench.windManual") },
        ]}
        value={wind ? "manual" : "forecast"}
        onChange={(mode) => setWind(mode === "manual" ? (wind ?? CALM) : null)}
      />
      {wind && (
        <div className="grid grid-cols-2 gap-3">
          <Field
            label={t("workbench.windSpeed")}
            htmlFor="wind-speed"
            hint={t("workbench.windSpeedHint", { max: WIND_MAX_KMH })}
            error={errorFor(errors, "wind.speed")}
          >
            <WindInput
              id="wind-speed"
              name="wind-speed"
              max={WIND_MAX_KMH}
              value={wind.speedKmh}
              onValue={(speedKmh) => setWind({ ...wind, speedKmh })}
            />
          </Field>
          <Field
            label={t("workbench.windDirection")}
            htmlFor="wind-direction"
            hint={t("workbench.windDirectionHint", {
              value: wind.directionFrom,
              direction: t(`montecarlo.direction.${compassPoint(wind.directionFrom)}`),
            })}
            error={errorFor(errors, "wind.direction_from")}
          >
            <WindInput
              id="wind-direction"
              name="wind-direction"
              max={DIRECTION_MAX}
              value={wind.directionFrom}
              onValue={(directionFrom) => setWind({ ...wind, directionFrom })}
            />
          </Field>
        </div>
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

/**
 * A number input clamped to 0–`max`: every parseable value is stored at once
 * (clamped), the typed text is kept while it agrees, and leaving the field
 * shows the stored value (an empty field keeps the previous one).
 */
function WindInput({
  value,
  max,
  onValue,
  ...props
}: {
  id: string;
  name: string;
  max: number;
  value: number;
  onValue: (value: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const typing = editing !== null && (editing.trim() === "" || Number(editing) === value);
  return (
    <TextInput
      {...props}
      type="number"
      inputMode="decimal"
      autoComplete="off"
      min={0}
      max={max}
      step="any"
      className="h-9"
      value={typing ? editing : String(value)}
      onChange={(e) => {
        const text = e.target.value;
        setEditing(text);
        const num = Number(text);
        if (text.trim() !== "" && Number.isFinite(num)) onValue(clamp(num, max));
      }}
      onBlur={() => setEditing(null)}
    />
  );
}
