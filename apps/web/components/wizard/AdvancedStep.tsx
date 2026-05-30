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
  getScenarioTemplate,
  validateScenario,
  type AtmosphereModel,
  type Dispersion,
  type FieldError,
} from "@/lib/api";
import { useWizard } from "./WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { Button, Callout, Eyebrow, Field, Spinner, TextInput, cn, selectClass } from "@/components/ui";

type Presets = Record<string, Record<string, Dispersion>>;

const PARAM_LABELS: Record<string, string> = {
  mass: "Mass",
  inclination: "Inclination",
  heading: "Heading",
  wind_factor: "Wind factor",
  thrust: "Thrust",
  rail_length: "Rail length",
};

const MODEL_LABELS: Record<AtmosphereModel, string> = {
  forecast: "Real forecast (GFS)",
  standard_atmosphere: "Standard atmosphere",
  wyoming_sounding: "Wyoming sounding",
  reanalysis: "Reanalysis (ERA5 file)",
};

export function AdvancedStep() {
  const { state, setUncertainty, setRail, setAtmosphere, next, scenarioBody } = useWizard();
  const { logout } = useAuth();

  const [presets, setPresets] = useState<Presets | null>(null);
  const [selected, setSelected] = useState<string>("Typical");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [validating, setValidating] = useState(false);

  // Load presets once; seed uncertainty with Typical if not set yet.
  useEffect(() => {
    let active = true;
    getScenarioTemplate()
      .then((t) => {
        if (!active) return;
        setPresets(t.uncertainty_presets);
        if (state.uncertainty === null && t.uncertainty_presets["Typical"]) {
          setUncertainty(t.uncertainty_presets["Typical"]);
        }
      })
      .catch((err) => {
        if (err instanceof ApiError && err.isUnauthorized) logout();
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function choosePreset(name: string) {
    setSelected(name);
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
      if (err instanceof ApiError && err.isValidation) setErrors(err.fieldErrors ?? []);
      else
        setErrors([
          { loc: [], field: "", message: err instanceof Error ? err.message : "Validation failed." },
        ]);
    } finally {
      setValidating(false);
    }
  }

  const model = state.atmosphere.model;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>Step 3 · Fine-tuning</Eyebrow>
        <h2 className="text-2xl font-semibold tracking-tight">Fine-tuning</h2>
        <p className="text-sm text-muted">
          Optional. The defaults are sensible — open a section only if you want more control.
        </p>
      </div>

      {/* Uncertainty presets */}
      <details className="rounded-2xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/10" open>
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Uncertainty budget
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {["Typical", "Conservative", "Precise", "Customize"].map((name) => (
              <label
                key={name}
                className={[
                  "cursor-pointer rounded-full px-4 py-2 text-sm font-medium ring-1 ring-inset transition-all duration-500 ease-[var(--ease-spring)]",
                  selected === name
                    ? "bg-cyan-400/10 text-cyan-200 ring-cyan-400/40 shadow-[0_0_24px_-10px_rgba(34,211,238,0.6)]"
                    : "text-muted ring-white/10 hover:text-foreground hover:ring-white/25",
                ].join(" ")}
              >
                <input
                  type="radio"
                  name="preset"
                  className="sr-only"
                  checked={selected === name}
                  onChange={() => choosePreset(name)}
                />
                {name}
              </label>
            ))}
          </div>

          {selected === "Customize" && state.uncertainty && (
            <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2.5 font-medium">Parameter</th>
                    <th className="px-3 py-2.5 font-medium">Std deviation</th>
                    <th className="px-3 py-2.5 font-medium">Kind</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(state.uncertainty).map(([key, disp]) => (
                    <tr key={key} className="border-t border-white/[0.06]">
                      <td className="px-3 py-2.5 font-medium text-foreground/90">
                        {PARAM_LABELS[key] ?? key}
                      </td>
                      <td className="px-3 py-2.5">
                        <TextInput
                          type="number"
                          step="any"
                          className="h-9 w-28"
                          value={disp.std}
                          onChange={(e) => editDispersion(key, { std: Number(e.target.value) })}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <select
                          className={cn(selectClass, "h-9 w-auto px-3")}
                          value={disp.kind}
                          onChange={(e) =>
                            editDispersion(key, { kind: e.target.value as Dispersion["kind"] })
                          }
                        >
                          <option value="relative">relative</option>
                          <option value="absolute">absolute</option>
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
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Launch rail overrides
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Length (m)" htmlFor="rl">
            <TextInput
              id="rl"
              type="number"
              step="any"
              value={state.rail?.length ?? ""}
              onChange={(e) => editRail("length", e.target.value)}
            />
          </Field>
          <Field label="Inclination (°)" htmlFor="ri">
            <TextInput
              id="ri"
              type="number"
              step="any"
              value={state.rail?.inclination ?? ""}
              onChange={(e) => editRail("inclination", e.target.value)}
            />
          </Field>
          <Field label="Heading (°)" htmlFor="rh">
            <TextInput
              id="rh"
              type="number"
              step="any"
              value={state.rail?.heading ?? ""}
              onChange={(e) => editRail("heading", e.target.value)}
            />
          </Field>
        </div>
      </details>

      {/* Atmosphere override */}
      <details className="rounded-2xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/10">
        <summary className="cursor-pointer text-sm font-semibold text-foreground">
          Atmosphere model ({MODEL_LABELS[model]})
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <Field label="Model" htmlFor="am">
            <select
              id="am"
              className={selectClass}
              value={model}
              onChange={(e) =>
                setAtmosphere({ ...state.atmosphere, model: e.target.value as AtmosphereModel })
              }
            >
              {(Object.keys(MODEL_LABELS) as AtmosphereModel[]).map((m) => (
                <option key={m} value={m}>
                  {MODEL_LABELS[m]}
                </option>
              ))}
            </select>
          </Field>
          {model === "wyoming_sounding" && (
            <Field label="Station id" htmlFor="station" hint="Required for Wyoming soundings.">
              <TextInput
                id="station"
                value={state.atmosphere.station ?? ""}
                onChange={(e) =>
                  setAtmosphere({ ...state.atmosphere, station: e.target.value || null })
                }
              />
            </Field>
          )}
          {model === "reanalysis" && (
            <Field label="ERA5 file path" htmlFor="file" hint="Required for reanalysis.">
              <TextInput
                id="file"
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
        <Callout tone="error" title="Please fix the following">
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
          {validating && <Spinner />}
          {validating ? "Checking…" : "Review"}
        </Button>
      </div>
    </div>
  );
}
