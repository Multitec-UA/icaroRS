"use client";

/**
 * Uncertainty presets — Typical / Conservative / Precise from the scenario
 * template (GET /api/scenario/template, never hardcoded), with the per-
 * parameter table behind a "Fine-tune" disclosure. Editing any cell turns
 * the preset into a custom one (no segment pressed, "Custom" chip shown).
 * The seeding, preset and cell-editing rules are the wizard's AdvancedStep's.
 */

import { useEffect, useId, useState } from "react";
import type { Dispersion } from "@/lib/api";
import { useScenarioTemplateQuery } from "@/lib/queries";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { SegmentedControl, TextInput } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing, selectClass } from "@/lib/styles";
import { ChevronDownIcon } from "./icons";
import { Section } from "./Section";

type Presets = Record<string, Record<string, Dispersion>>;

// API-level preset names (from the scenario template) — keys, never translated.
const PRESET_NAMES = ["Typical", "Conservative", "Precise"] as const;
type PresetName = (typeof PRESET_NAMES)[number];
type Selection = PresetName | "Customize";

const PRESET_KEY: Record<PresetName, `advanced.preset${string}`> = {
  Typical: "advanced.presetTypical",
  Conservative: "advanced.presetConservative",
  Precise: "advanced.presetPrecise",
};

export function UncertaintySection() {
  const t = useT();
  const { state, setUncertainty } = useWizardDraft();
  // A 401 here is handled globally (lib/query-client.ts).
  const { data: template } = useScenarioTemplateQuery();
  const presets: Presets | null = template?.uncertainty_presets ?? null;
  const [selected, setSelected] = useState<Selection>("Typical");
  const [open, setOpen] = useState(false);
  // Raw text of a std-dev cell while it is being edited. `Number("")` is 0,
  // so coercing on every keystroke would snap a cleared field to "0" before
  // the user types the new value; the committed number lives in the draft.
  const [stdDrafts, setStdDrafts] = useState<Record<string, string>>({});
  const tableId = useId();

  // Seed the draft with "Typical" once the template has loaded, if nothing
  // set it yet. The effect also depends on `state.uncertainty`: once set,
  // the guard is false and it converges (no loop, no stale closure).
  useEffect(() => {
    if (presets && state.uncertainty === null && presets["Typical"]) {
      setUncertainty(presets["Typical"]);
    }
  }, [presets, state.uncertainty, setUncertainty]);

  function choosePreset(name: PresetName) {
    setSelected(name);
    setStdDrafts({});
    if (presets?.[name]) setUncertainty(presets[name]);
  }

  function editDispersion(key: string, patch: Partial<Dispersion>) {
    const current = state.uncertainty ?? {};
    const entry = current[key] ?? { std: 0, kind: "relative" as const };
    setSelected("Customize");
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

  const fineTune = (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={tableId}
      onClick={() => setOpen((v) => !v)}
      className={cn(
        "flex items-center gap-1 rounded-md text-[13px] text-accent-ink transition-colors duration-300 hover:text-ink",
        focusRing,
      )}
    >
      {t("workbench.fineTune")}
      <ChevronDownIcon
        className={cn("transition-transform duration-300 ease-[var(--ease-spring)]", open && "rotate-180")}
      />
    </button>
  );

  return (
    <Section title={t("workbench.uncertainty")} index={3} action={fineTune}>
      <div className="flex items-center gap-2">
        <SegmentedControl
          className="min-w-0 flex-1"
          label={t("advanced.uncertaintyPresetLegend")}
          options={PRESET_NAMES.map((name) => ({ value: name, label: t(PRESET_KEY[name]) }))}
          value={selected === "Customize" ? null : selected}
          onChange={choosePreset}
        />
        {selected === "Customize" && (
          <span className="shrink-0 rounded-[7px] bg-accent-soft px-2 py-1 text-xs font-medium text-accent-ink">
            {t("workbench.presetCustom")}
          </span>
        )}
      </div>

      <div id={tableId} hidden={!open} className="flex flex-col gap-2">
        <p className="text-xs text-muted">{t("workbench.fineTuneHint")}</p>
        {state.uncertainty && (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("advanced.tableHeaderParameter")}</th>
                  <th className="px-3 py-2 font-medium">{t("advanced.tableHeaderStdDev")}</th>
                  <th className="px-3 py-2 font-medium">{t("advanced.tableHeaderKind")}</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(state.uncertainty).map(([key, disp]) => (
                  <tr key={key} className="border-t border-divider">
                    <td className="px-3 py-2 font-medium text-ink-2">{paramLabel(key)}</td>
                    <td className="px-3 py-2 tabular-nums">
                      <TextInput
                        type="number"
                        inputMode="decimal"
                        autoComplete="off"
                        step="any"
                        name={`std-${key}`}
                        aria-label={t("advanced.stdDevFor", { param: paramLabel(key) })}
                        className="h-9 w-24 px-2 tabular-nums"
                        value={stdDrafts[key] ?? disp.std}
                        onChange={(e) => editStd(key, e.target.value)}
                        onBlur={() => commitStd(key)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        name={`kind-${key}`}
                        aria-label={t("advanced.kindFor", { param: paramLabel(key) })}
                        className={cn(selectClass, "h-9 w-auto px-2")}
                        value={disp.kind}
                        onChange={(e) => editDispersion(key, { kind: e.target.value as Dispersion["kind"] })}
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
    </Section>
  );
}
