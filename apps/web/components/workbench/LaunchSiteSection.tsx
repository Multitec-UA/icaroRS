"use client";

/**
 * Launch site — the map + coordinates block of the inputs column. Picking a
 * point (map click or place search) fills latitude/longitude and looks the
 * elevation up from the DEM (GET /api/elevation); the three fields stay
 * editable by hand. Same logic the wizard's BasicsStep had.
 *
 * The elevation shows and accepts the selected length unit (m or ft, units
 * S5); the draft keeps metres, so switching units never changes the run.
 */

import { useCallback, useState } from "react";
import { ApiError, getElevation, type FieldError } from "@/lib/api";
import { inputNumber, sameNumber } from "@/lib/domain/scenario";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { useUnits } from "@/components/units/UnitsProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { SitePicker } from "@/components/map/SitePicker";
import { Field, TextInput } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { errorFor } from "./fieldErrors";
import { Section } from "./Section";

export function LaunchSiteSection({ errors }: { errors: FieldError[] }) {
  const t = useT();
  const { state, setSite } = useWizardDraft();
  const { logout } = useAuth();
  const [elevationNote, setElevationNote] = useState<string | null>(null);
  const units = useUnits();
  // Imperial only: the typed feet are kept while they still denote the
  // stored metres, so the round trip never rewrites the field mid-typing.
  const [elevationText, setElevationText] = useState<string | null>(null);
  const site = state.site;
  const elevationShown = shownElevation(site?.elevation ?? null, elevationText, units);

  const pickPoint = useCallback(
    async (lat: number, lon: number) => {
      setSite({ latitude: lat, longitude: lon, elevation: null });
      setElevationNote(t("workbench.elevationLookingUp"));
      try {
        const { elevation, source } = await getElevation(lat, lon);
        setSite({ latitude: lat, longitude: lon, elevation });
        setElevationNote(
          elevation !== null
            ? t("workbench.elevationAutoFilled", { source })
            : t("workbench.elevationEnterManually"),
        );
      } catch (err) {
        // getElevation() is a direct call, not a query: a 401 is ours to handle.
        if (err instanceof ApiError && err.isUnauthorized) return logout();
        setElevationNote(t("workbench.elevationFetchFailed"));
      }
    },
    [setSite, logout, t],
  );

  function updateSiteField(field: "latitude" | "longitude" | "elevation", value: string) {
    const typed = value === "" ? null : Number(value);
    const num = typed !== null && field === "elevation" ? units.si(typed, "length") : typed;
    const base = site ?? { latitude: NaN, longitude: NaN, elevation: null };
    setSite({
      latitude: field === "latitude" ? (num ?? NaN) : base.latitude,
      longitude: field === "longitude" ? (num ?? NaN) : base.longitude,
      elevation: field === "elevation" ? num : base.elevation,
    });
  }

  return (
    <Section title={t("workbench.launchSite")} index={0}>
      <SitePicker
        lat={site && Number.isFinite(site.latitude) ? site.latitude : null}
        lon={site && Number.isFinite(site.longitude) ? site.longitude : null}
        onPick={pickPoint}
      />

      {/* Coordinates stay type="number" (lat/lon need the minus sign, which a
          numeric keypad lacks); inputMode="decimal" picks the right mobile
          keyboard. autoComplete="off" keeps password managers away. */}
      <div className="grid grid-cols-3 gap-2">
        <Field label={t("workbench.fieldLatitude")} htmlFor="lat" error={errorFor(errors, "site.latitude")}>
          <TextInput
            id="lat"
            name="latitude"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            step="any"
            className="h-9"
            value={site && Number.isFinite(site.latitude) ? site.latitude : ""}
            onChange={(e) => updateSiteField("latitude", e.target.value)}
          />
        </Field>
        <Field label={t("workbench.fieldLongitude")} htmlFor="lon" error={errorFor(errors, "site.longitude")}>
          <TextInput
            id="lon"
            name="longitude"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            step="any"
            className="h-9"
            value={site && Number.isFinite(site.longitude) ? site.longitude : ""}
            onChange={(e) => updateSiteField("longitude", e.target.value)}
          />
        </Field>
        <Field label={t("workbench.fieldElevation", { unit: units.label("length") })} htmlFor="elev" error={errorFor(errors, "site.elevation")}>
          <TextInput
            id="elev"
            name="elevation"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            step="any"
            className="h-9"
            value={elevationShown}
            onChange={(e) => {
              if (units.system === "imperial") setElevationText(e.target.value);
              updateSiteField("elevation", e.target.value);
            }}
            onBlur={() => setElevationText(null)}
          />
        </Field>
      </div>
      {/* The DEM lookup resolves asynchronously after a map click, so its
          note is an always-mounted live region: "Looking up…" → "Auto-filled…". */}
      <p aria-live="polite" className="min-h-4 text-xs text-muted">
        {elevationNote}
      </p>
    </Section>
  );
}

/** The elevation field's value: metres as stored in metric, feet (or the typed text) in imperial. */
function shownElevation(
  elevation: number | null,
  text: string | null,
  units: ReturnType<typeof useUnits>,
): number | string {
  if (units.system === "metric") return elevation !== null ? elevation : "";
  const shown = elevation === null ? null : units.display(elevation, "length");
  if (text !== null && (text.trim() === "" ? shown === null : shown !== null && sameNumber(Number(text), shown))) {
    return text;
  }
  return shown === null ? "" : inputNumber(shown, units.system);
}
