"use client";

/**
 * Step 2 — Launch site & time. The non-expert core of the wizard:
 *   • pick the site on a map (or search) → elevation auto-fills from the DEM
 *   • pick a date/time → the API suggests the best atmosphere model
 *     (real GFS forecast if within range, else standard atmosphere)
 *
 * "Continue" validates the whole scenario against /api/scenario/validate — the
 * API is the authority — and surfaces any field errors inline (AC-RG-3.9).
 */

import { useCallback, useState } from "react";
import {
  ApiError,
  getElevation,
  suggestAtmosphere,
  validateScenario,
  type AtmosphereSuggestion,
  type FieldError,
} from "@/lib/api";
import { launchDateToIso, resolveTimeZone, toLaunchDate } from "@/lib/domain/scenario";
import { useWizard } from "./WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { SitePicker } from "@/components/map/SitePicker";
import { Button, Callout, Eyebrow, Field, InfoTip, Spinner, TextInput } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";

// Scenario field path → input id for every input on this step, in DOM
// order, so a failed validation can focus the first one that errored.
const FIELD_INPUTS: ReadonlyArray<readonly [path: string, inputId: string]> = [
  ["site.latitude", "lat"],
  ["site.longitude", "lon"],
  ["site.elevation", "elev"],
  ["date", "dt"],
];

function matchesField(prefix: string, field: string): boolean {
  return field === prefix || field.startsWith(`${prefix}.`);
}

export function BasicsStep() {
  const { state, setSite, setLaunchDatetime, setAtmosphere, next, scenarioBody } =
    useWizard();
  const { logout } = useAuth();
  const t = useT();

  const [elevationNote, setElevationNote] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AtmosphereSuggestion | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [validating, setValidating] = useState(false);

  const site = state.site;

  const errorFor = (prefix: string) =>
    errors.find((e) => matchesField(prefix, e.field))?.message;
  const generalErrors = errors.filter((e) => e.field === "");

  function focusFirstError(fieldErrors: FieldError[]) {
    const first = FIELD_INPUTS.find(([path]) => fieldErrors.some((e) => matchesField(path, e.field)));
    if (first) document.getElementById(first[1])?.focus();
  }

  // --- site picking + elevation ----------------------------------------
  const pickPoint = useCallback(
    async (lat: number, lon: number) => {
      setSite({ latitude: lat, longitude: lon, elevation: null });
      setElevationNote(t("basics.elevationLookingUp"));
      try {
        const { elevation, source } = await getElevation(lat, lon);
        setSite({ latitude: lat, longitude: lon, elevation });
        setElevationNote(
          elevation !== null
            ? t("basics.elevationAutoFilled", { source })
            : t("basics.elevationEnterManually"),
        );
      } catch (err) {
        if (err instanceof ApiError && err.isUnauthorized) return logout();
        setElevationNote(t("basics.elevationFetchFailed"));
      }
    },
    [setSite, logout, t],
  );

  function updateSiteField(field: "latitude" | "longitude" | "elevation", value: string) {
    const num = value === "" ? null : Number(value);
    const base = site ?? { latitude: NaN, longitude: NaN, elevation: null };
    setSite({
      latitude: field === "latitude" ? (num ?? NaN) : base.latitude,
      longitude: field === "longitude" ? (num ?? NaN) : base.longitude,
      elevation: field === "elevation" ? num : base.elevation,
    });
  }

  // --- date → atmosphere suggestion -------------------------------------
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

  // --- continue: validate against the API -------------------------------
  async function onContinue() {
    setValidating(true);
    setErrors([]);
    try {
      await validateScenario(scenarioBody());
      next();
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) return logout();
      if (err instanceof ApiError && err.isValidation) {
        const fieldErrors = err.fieldErrors ?? [];
        setErrors(fieldErrors);
        focusFirstError(fieldErrors);
      } else {
        setErrors([
          { loc: [], field: "", message: err instanceof Error ? err.message : t("basics.errorValidationFailed") },
        ]);
      }
    } finally {
      setValidating(false);
    }
  }

  // Resolve localized model label for the suggestion callout
  function modelLabel(model: string): string {
    if (model === "forecast") return t("basics.modelForecastLabel");
    if (model === "standard_atmosphere") return t("basics.modelStandardLabel");
    return model;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>{t("basics.eyebrow")}</Eyebrow>
        <h2
          tabIndex={-1}
          className="text-balance text-2xl font-semibold tracking-tight outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        >
          {t("basics.heading")}
        </h2>
        <p className="text-sm text-muted">
          {t("basics.description")}
        </p>
      </div>

      <SitePicker
        lat={site && Number.isFinite(site.latitude) ? site.latitude : null}
        lon={site && Number.isFinite(site.longitude) ? site.longitude : null}
        onPick={pickPoint}
      />

      {/* Coordinates stay type="number" (lat/lon need the minus sign, which a
          numeric keypad lacks); inputMode="decimal" picks the right mobile
          keyboard. autoComplete="off" keeps password managers away. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label={t("basics.fieldLatitude")} htmlFor="lat" error={errorFor("site.latitude")}>
          <TextInput
            id="lat"
            name="latitude"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            step="any"
            value={site && Number.isFinite(site.latitude) ? site.latitude : ""}
            onChange={(e) => updateSiteField("latitude", e.target.value)}
          />
        </Field>
        <Field label={t("basics.fieldLongitude")} htmlFor="lon" error={errorFor("site.longitude")}>
          <TextInput
            id="lon"
            name="longitude"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            step="any"
            value={site && Number.isFinite(site.longitude) ? site.longitude : ""}
            onChange={(e) => updateSiteField("longitude", e.target.value)}
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field
            label={t("basics.fieldElevation")}
            htmlFor="elev"
            hint={elevationNote ? undefined : t("basics.elevationHint")}
            error={errorFor("site.elevation")}
          >
            <TextInput
                id="elev"
              name="elevation"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              step="any"
              value={site && site.elevation !== null ? site.elevation : ""}
              onChange={(e) => updateSiteField("elevation", e.target.value)}
            />
          </Field>
          {/* The DEM lookup resolves asynchronously after a map click, so its
              note is a live region (always mounted) rather than the static
              hint — screen readers hear "Looking up…" → "Auto-filled…". */}
          <p aria-live="polite" className="text-xs text-muted">
            {elevationNote}
          </p>
        </div>
      </div>

      <Field
        label={t("basics.fieldDateTime")}
        htmlFor="dt"
        term="forecast"
        error={errorFor("date")}
        hint={t("basics.dateTimeHint", { timeZone: resolveTimeZone() })}
      >
        <TextInput
          id="dt"
          name="launch-datetime"
          autoComplete="off"
          type="datetime-local"
          // The domain LaunchDate is hour-granular (no minutes) — step=3600s
          // constrains the picker to whole hours so the UI never invites a
          // precision the simulation will silently drop.
          step={3600}
          value={state.launchDatetime ?? ""}
          onChange={(e) => onDateChange(e.target.value)}
        />
      </Field>

      {suggestion && (
        <Callout tone={suggestion.needs_internet ? "success" : "info"}>
          <div className="flex items-center gap-1.5">
            <strong>{modelLabel(suggestion.model)}</strong>
            <InfoTip term={suggestion.model === "forecast" ? "forecast" : "standard_atmosphere"} />
          </div>
          {/* suggestion.reason is API-originated English — rendered verbatim per RG-6.1/6.2 */}
          <p className="mt-0.5">{suggestion.reason}</p>
          <p className="mt-1 text-xs opacity-75">{t("common.technicalEnglishNote")}</p>
        </Callout>
      )}

      {generalErrors.length > 0 && (
        <Callout tone="error" title={t("basics.errorsTitle")}>
          <ul className="list-disc pl-5">
            {generalErrors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={validating} withArrow={!validating}>
          {validating && <Spinner decorative />}
          {validating ? t("basics.checking") : t("basics.continue")}
        </Button>
      </div>
    </div>
  );
}
