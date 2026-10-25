"use client";

/**
 * Launch site — the map + coordinates block of the inputs column. Picking a
 * point (map click or place search) fills latitude/longitude and looks the
 * elevation up from the DEM (GET /api/elevation); the three fields stay
 * editable by hand. Same logic the wizard's BasicsStep had.
 */

import { useCallback, useState } from "react";
import { ApiError, getElevation, type FieldError } from "@/lib/api";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
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
  const site = state.site;

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
        // getElevation() is a direct call, not a query: a 401 is ours to handle.
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
        <Field label={t("basics.fieldLatitude")} htmlFor="lat" error={errorFor(errors, "site.latitude")}>
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
        <Field label={t("basics.fieldLongitude")} htmlFor="lon" error={errorFor(errors, "site.longitude")}>
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
        <Field label={t("basics.fieldElevation")} htmlFor="elev" error={errorFor(errors, "site.elevation")}>
          <TextInput
            id="elev"
            name="elevation"
            type="number"
            inputMode="decimal"
            autoComplete="off"
            step="any"
            className="h-9"
            value={site && site.elevation !== null ? site.elevation : ""}
            onChange={(e) => updateSiteField("elevation", e.target.value)}
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
