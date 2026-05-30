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
import { useWizard } from "./WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { SitePicker } from "@/components/map/SitePicker";
import { Button, Callout, Eyebrow, Field, InfoTip, Spinner, TextInput } from "@/components/ui";

export function BasicsStep() {
  const { state, setSite, setLaunchDatetime, setAtmosphere, next, scenarioBody } =
    useWizard();
  const { logout } = useAuth();

  const [elevationNote, setElevationNote] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AtmosphereSuggestion | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [validating, setValidating] = useState(false);

  const site = state.site;

  const errorFor = (prefix: string) =>
    errors.find((e) => e.field === prefix || e.field.startsWith(`${prefix}.`))?.message;
  const generalErrors = errors.filter((e) => e.field === "");

  // --- site picking + elevation ----------------------------------------
  const pickPoint = useCallback(
    async (lat: number, lon: number) => {
      setSite({ latitude: lat, longitude: lon, elevation: null });
      setElevationNote("Looking up elevation…");
      try {
        const { elevation, source } = await getElevation(lat, lon);
        setSite({ latitude: lat, longitude: lon, elevation });
        setElevationNote(
          elevation !== null ? `Elevation auto-filled (${source}).` : "Enter elevation manually.",
        );
      } catch (err) {
        if (err instanceof ApiError && err.isUnauthorized) return logout();
        setElevationNote("Couldn't fetch elevation — enter it manually below.");
      }
    },
    [setSite, logout],
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
    if (!value) {
      setSuggestion(null);
      return;
    }
    try {
      const s = await suggestAtmosphere(value);
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
        setErrors(err.fieldErrors ?? []);
      } else {
        setErrors([
          { loc: [], field: "", message: err instanceof Error ? err.message : "Validation failed." },
        ]);
      }
    } finally {
      setValidating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>Step 2 · Launch site &amp; time</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight">Where and when?</h2>
        <p className="text-sm text-muted">
          Pick the launch site and time. We&apos;ll choose the best weather model for you.
        </p>
      </div>

      <SitePicker
        lat={site && Number.isFinite(site.latitude) ? site.latitude : null}
        lon={site && Number.isFinite(site.longitude) ? site.longitude : null}
        onPick={pickPoint}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Latitude" htmlFor="lat" error={errorFor("site.latitude")}>
          <TextInput
            id="lat"
            type="number"
            step="any"
            value={site && Number.isFinite(site.latitude) ? site.latitude : ""}
            onChange={(e) => updateSiteField("latitude", e.target.value)}
          />
        </Field>
        <Field label="Longitude" htmlFor="lon" error={errorFor("site.longitude")}>
          <TextInput
            id="lon"
            type="number"
            step="any"
            value={site && Number.isFinite(site.longitude) ? site.longitude : ""}
            onChange={(e) => updateSiteField("longitude", e.target.value)}
          />
        </Field>
        <Field label="Elevation (m)" htmlFor="elev" hint={elevationNote ?? "Above sea level."} error={errorFor("site.elevation")}>
          <TextInput
            id="elev"
            type="number"
            step="any"
            value={site && site.elevation !== null ? site.elevation : ""}
            onChange={(e) => updateSiteField("elevation", e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Launch date & hour (UTC)"
        htmlFor="dt"
        term="forecast"
        error={errorFor("date")}
        hint="Simulated to the whole hour (UTC). Within ~16 days, we use a real weather forecast."
      >
        <TextInput
          id="dt"
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
            <strong>
              {suggestion.model === "forecast"
                ? "Real weather forecast (GFS)"
                : suggestion.model === "standard_atmosphere"
                  ? "Standard atmosphere"
                  : suggestion.model}
            </strong>
            <InfoTip term={suggestion.model === "forecast" ? "forecast" : "standard_atmosphere"} />
          </div>
          <p className="mt-0.5">{suggestion.reason}</p>
        </Callout>
      )}

      {generalErrors.length > 0 && (
        <Callout tone="error" title="Please fix the following">
          <ul className="list-disc pl-5">
            {generalErrors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={validating} withArrow={!validating}>
          {validating && <Spinner />}
          {validating ? "Checking…" : "Continue"}
        </Button>
      </div>
    </div>
  );
}
