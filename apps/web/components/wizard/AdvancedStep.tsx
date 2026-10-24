"use client";

/**
 * Step 3 — Fine-tuning (optional, collapsed by default). For users who want
 * more control:
 *   • uncertainty preset: Typical / Conservative / Precise / Customize
 *   • optional launch-rail overrides
 *   • optional atmosphere-model override (with conditional fields)
 *
 * Presets come from /api/scenario/template so the UI never hardcodes them.
 * "Continue" validates against the API (catches e.g. wyoming_sounding without a
 * station).
 */

import { useEffect, useState } from "react";
import {
  ApiError,
  validateScenario,
  type AtmosphereModel,
  type Dispersion,
  type FieldError,
} from "@/lib/api";
import { useScenarioTemplateQuery } from "@/lib/queries";
import { useWizard } from "./WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { Button, Callout, Eyebrow, Field, Spinner, TextInput } from "@/components/ui";
import { cn, focusRing, selectClass } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";

type Presets = Record<string, Record<string, Dispersion>>;

// API-level preset names (from scenario template) — NOT translated, used as keys
const PRESET_NAMES = ["Typical", "Conservative", "Precise", "Customize"] as const;
type PresetName = typeof PRESET_NAMES[number];

// Maps API preset name → translation key suffix
const PRESET_KEY: Record<PresetName, string> = {
  Typical: "advanced.presetTypical",
  Conservative: "advanced.presetConservative",
  Precise: "advanced.presetPrecise",
  Customize: "advanced.presetCustomize",
};

const MODEL_KEYS = ["forecast", "standard_atmosphere", "wyoming_sounding", "reanalysis"] as const;

// Scenario field path → input id for every Field on this step, in DOM
// order, so a validation error lands inline on its input, the first one is
// focused, and the <details> hiding it is opened.
const FIELD_INPUTS: ReadonlyArray<readonly [path: string, inputId: string]> = [
  ["rail.length", "rl"],
  ["rail.inclination", "ri"],
  ["rail.heading", "rh"],
  ["atmosphere.model", "am"],
  ["atmosphere.station", "station"],
  ["atmosphere.file", "file"],
];

function matchesField(prefix: string, field: string): boolean {
  return field === prefix || field.startsWith(`${prefix}.`);
}

export function AdvancedStep() {
  const { state, setUncertainty, setRail, setAtmosphere, next, scenarioBody } = useWizard();
  const { logout } = useAuth();
  const t = useT();

  // A 401 here is handled globally (lib/query-client.ts).
  const { data: template } = useScenarioTemplateQuery();
  const presets: Presets | null = template?.uncertainty_presets ?? null;
  const [selected, setSelected] = useState<PresetName>("Typical");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [validating, setValidating] = useState(false);
  // Raw text of a std-dev cell while it is being edited. `Number("")` is 0,
  // so coercing on every keystroke would snap a cleared field to "0" before
  // the user types the new value; the committed number lives in the draft.
  const [stdDrafts, setStdDrafts] = useState<Record<string, string>>({});

  const errorFor = (prefix: string) => errors.find((e) => matchesField(prefix, e.field))?.message;

  function focusFirstError(fieldErrors: FieldError[]) {
    const first = FIELD_INPUTS.find(([path]) => fieldErrors.some((e) => matchesField(path, e.field)));
    const el = first ? document.getElementById(first[1]) : null;
    if (!el) return;
    const section = el.closest("details");
    if (section) section.open = true;
    el.focus();
  }

  // Seed uncertainty with the "Typical" preset once the template has loaded,
  // if nothing has set it yet. Depending on `state.uncertainty` looks
  // suspicious for an effect that also SETS it, but it's what makes this
  // safe without an exhaustive-deps suppression: once setUncertainty runs,
  // `state.uncertainty` becomes non-null, the effect re-runs, the guard is
  // now false, and it converges — no infinite loop, no stale closure.
  useEffect(() => {
    if (presets && state.uncertainty === null && presets["Typical"]) {
      setUncertainty(presets["Typical"]);
    }
  }, [presets, state.uncertainty, setUncertainty]);

  function choosePreset(name: PresetName) {
    setSelected(name);
    setStdDrafts({});
    if (name !== "Customize" && presets?.[name]) {
      setUncertainty(presets[name]);
    } else if (name === "Customize" && state.uncertainty === null && presets?.["Typical"]) {
      setUncertainty(presets["Typical"]);
    }
  }

  function editDispersion(key: string, patch: Partial<Dispersion>) {
    const current = state.uncertainty ?? {};
    const entry = current[key] ?? { std: 0, kind: "relative" as const };
    setUncertainty({ ...current, [key]: { ...entry, ...patch } });
  }

  function editStd(key: string, raw: string) {
    setStdDrafts((d) => ({ ...d, [key]: raw }));
    const num = Number(raw);
    if (raw !== "" && Number.isFinite(num)) editDispersion(key, { std: num });
  }

  function commitStd(key: string) {
    // Leaving the cell shows the committed number again (an emptied cell
    // falls back to the last valid value rather than silently becoming 0).
    setStdDrafts((drafts) => {
      const rest = { ...drafts };
      delete rest[key];
      return rest;
    });
  }

  function paramLabel(key: string): string {
    const label = t(`advanced.paramLabels.${key}`);
    return label !== `advanced.paramLabels.${key}` ? label : key;
  }

  function editRail(field: "length" | "inclination" | "heading", value: string) {
    const num = value === "" ? null : Number(value);
    const base = state.rail ?? { length: null, inclination: null, heading: null };
    const nextRail = { ...base, [field]: num };
    const allEmpty =
      nextRail.length === null && nextRail.inclination === null && nextRail.heading === null;
    setRail(allEmpty ? null : nextRail);
  }

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
      } else
        setErrors([
          { loc: [], field: "", message: err instanceof Error ? err.message : t("advanced.errorValidationFailed") },
        ]);
    } finally {
      setValidating(false);
    }
  }

  const model = state.atmosphere.model;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>{t("advanced.eyebrow")}</Eyebrow>
        <h2
          tabIndex={-1}
          className="text-balance text-2xl font-semibold tracking-tight outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        >
          {t("advanced.heading")}
        </h2>
        <p className="text-sm text-muted">
          {t("advanced.description")}
        </p>
      </div>

      {/* Uncertainty presets */}
      <details className="rounded-2xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/10" open>
        <summary className={cn("cursor-pointer rounded-md text-sm font-semibold text-foreground", focusRing)}>
          {t("advanced.uncertaintyBudget")}
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <fieldset className="flex flex-wrap gap-2">
            <legend className="sr-only">{t("advanced.uncertaintyPresetLegend")}</legend>
            {PRESET_NAMES.map((name) => (
              <label
                key={name}
                className={cn(
                  "cursor-pointer rounded-full px-4 py-2 text-sm font-medium ring-1 ring-inset transition-[background-color,color,box-shadow] duration-500 ease-[var(--ease-spring)]",
                  // The radio is sr-only, so the pill shows the focus ring on its behalf.
                  "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-400/60",
                  selected === name
                    ? "bg-cyan-400/10 text-cyan-200 ring-cyan-400/40 shadow-[0_0_24px_-10px_rgba(34,211,238,0.6)]"
                    : "text-muted ring-white/10 hover:text-foreground hover:ring-white/25",
                )}
              >
                <input
                  type="radio"
                  name="preset"
                  className="sr-only"
                  checked={selected === name}
                  onChange={() => choosePreset(name)}
                />
                {t(PRESET_KEY[name])}
              </label>
            ))}
          </fieldset>

          {selected === "Customize" && state.uncertainty && (
            <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">{t("advanced.tableHeaderParameter")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("advanced.tableHeaderStdDev")}</th>
                    <th className="px-3 py-2.5 font-medium">{t("advanced.tableHeaderKind")}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(state.uncertainty).map(([key, disp]) => (
                    <tr key={key} className="border-t border-white/[0.06]">
                      <td className="px-3 py-2.5 font-medium text-foreground/90">{paramLabel(key)}</td>
                      <td className="px-3 py-2.5 tabular-nums">
                        <TextInput
                          type="number"
                          inputMode="decimal"
                          autoComplete="off"
                          step="any"
                          name={`std-${key}`}
                          aria-label={t("advanced.stdDevFor", { param: paramLabel(key) })}
                          className="h-9 w-28 tabular-nums"
                          value={stdDrafts[key] ?? disp.std}
                          onChange={(e) => editStd(key, e.target.value)}
                          onBlur={() => commitStd(key)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          name={`kind-${key}`}
                          aria-label={t("advanced.kindFor", { param: paramLabel(key) })}
                          className={cn(selectClass, "h-9 w-auto px-3")}
                          value={disp.kind}
                          onChange={(e) =>
                            editDispersion(key, { kind: e.target.value as Dispersion["kind"] })
                          }
                        >
                          <option value="relative">{t("advanced.kindRelative")}</option>
                          <option value="absolute">{t("advanced.kindAbsolute")}</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      {/* Rail overrides */}
      <details className="rounded-2xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/10">
        <summary className={cn("cursor-pointer rounded-md text-sm font-semibold text-foreground", focusRing)}>
          {t("advanced.railOverrides")}
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t("advanced.railLength")} htmlFor="rl" error={errorFor("rail.length")}>
            <TextInput
              id="rl"
              name="rail-length"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              step="any"
              value={state.rail?.length ?? ""}
              onChange={(e) => editRail("length", e.target.value)}
            />
          </Field>
          <Field label={t("advanced.railInclination")} htmlFor="ri" error={errorFor("rail.inclination")}>
            <TextInput
              id="ri"
              name="rail-inclination"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              step="any"
              value={state.rail?.inclination ?? ""}
              onChange={(e) => editRail("inclination", e.target.value)}
            />
          </Field>
          <Field label={t("advanced.railHeading")} htmlFor="rh" error={errorFor("rail.heading")}>
            <TextInput
              id="rh"
              name="rail-heading"
              type="number"
              inputMode="decimal"
              autoComplete="off"
              step="any"
              value={state.rail?.heading ?? ""}
              onChange={(e) => editRail("heading", e.target.value)}
            />
          </Field>
        </div>
      </details>

      {/* Atmosphere override */}
      <details className="rounded-2xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/10">
        <summary className={cn("cursor-pointer rounded-md text-sm font-semibold text-foreground", focusRing)}>
          {t("advanced.atmosphereModel", { model: t(`models.${model}`) })}
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <Field label={t("advanced.fieldModel")} htmlFor="am" error={errorFor("atmosphere.model")}>
            <select
              id="am"
              className={selectClass}
              value={model}
              onChange={(e) =>
                setAtmosphere({ ...state.atmosphere, model: e.target.value as AtmosphereModel })
              }
            >
              {MODEL_KEYS.map((m) => (
                <option key={m} value={m}>
                  {t(`models.${m}`)}
                </option>
              ))}
            </select>
          </Field>
          {model === "wyoming_sounding" && (
            <Field
              label={t("advanced.fieldStationId")}
              htmlFor="station"
              hint={t("advanced.fieldStationHint")}
              error={errorFor("atmosphere.station")}
            >
              <TextInput
                id="station"
                name="station"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("advanced.stationPlaceholder")}
                value={state.atmosphere.station ?? ""}
                onChange={(e) =>
                  setAtmosphere({ ...state.atmosphere, station: e.target.value || null })
                }
              />
            </Field>
          )}
          {model === "reanalysis" && (
            <Field
              label={t("advanced.fieldEra5Path")}
              htmlFor="file"
              hint={t("advanced.fieldEra5Hint")}
              error={errorFor("atmosphere.file")}
            >
              <TextInput
                id="file"
                name="era5-file"
                autoComplete="off"
                spellCheck={false}
                placeholder={t("advanced.era5Placeholder")}
                value={state.atmosphere.file ?? ""}
                onChange={(e) =>
                  setAtmosphere({ ...state.atmosphere, file: e.target.value || null })
                }
              />
            </Field>
          )}
        </div>
      </details>

      {errors.length > 0 && (
        <Callout tone="error" title={t("advanced.errorsTitle")}>
          <ul className="list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>
                {e.field ? `${e.field}: ` : ""}
                {e.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="flex justify-end">
        <Button onClick={onContinue} disabled={validating} withArrow={!validating}>
          {validating && <Spinner decorative />}
          {validating ? t("advanced.checking") : t("advanced.review")}
        </Button>
      </div>
    </div>
  );
}
