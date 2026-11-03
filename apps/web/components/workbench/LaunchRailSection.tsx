"use client";

/**
 * Launch rail (S4) — length, inclination and heading, prefilled from the
 * active file's own values (`manifest.flight`, already converted by the
 * serializer to RocketPy's inclination from horizontal).
 *
 * Each field shows the file's value with a "From .ork" badge (the kit
 * Field's `labelAside`, on the label's line) until the user types over it; then it shows "Overridden" and a "Reset to …" link that
 * deletes the override. Only overrides are stored in the draft and sent to
 * /api/simulate (see `buildScenarioBody`), so a Reset truly resets and a
 * file switch never carries the previous file's values silently. With no
 * file loaded the fields are disabled with a "From your .ork" placeholder.
 *
 * Typing the file's own value back is not an override (WizardProvider drops
 * it, S12b). The inclination hint has a second line with the same angle in
 * OpenRocket's convention: "= {90 − value}° from vertical in OpenRocket".
 */

import { useState, type ReactNode } from "react";
import type { FieldError } from "@/lib/api";
import { useWizardDraft, type RailField } from "@/components/wizard/WizardProvider";
import { Field, TextInput } from "@/components/ui";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/styles";
import { errorFor } from "./fieldErrors";
import { textLink } from "./styles";
import { Section } from "./Section";

type MessageKey = Parameters<ReturnType<typeof useT>>[0];

const RAIL_FIELDS: ReadonlyArray<{
  field: RailField;
  id: string;
  name: string;
  labelKey: MessageKey;
  hintKey?: MessageKey;
  unit: string;
}> = [
  { field: "length", id: "rl", name: "rail-length", labelKey: "workbench.railLength", unit: " m" },
  {
    field: "inclination",
    id: "ri",
    name: "rail-inclination",
    labelKey: "workbench.railInclination",
    hintKey: "workbench.railInclinationHint",
    unit: "°",
  },
  {
    field: "heading",
    id: "rh",
    name: "rail-heading",
    labelKey: "workbench.railHeading",
    hintKey: "workbench.railHeadingHint",
    unit: "°",
  },
];

const badge = "whitespace-nowrap rounded-full px-2 py-px text-[11px] font-semibold leading-4";

export function LaunchRailSection({ errors }: { errors: FieldError[] }) {
  const t = useT();
  const { locale } = useLocale();
  const { state, setRailOverride, resetRailOverride } = useWizardDraft();
  const defaults = state.railDefaults;
  const hasFile = state.exportId !== null;

  return (
    <Section title={t("workbench.launchRail")} index={2}>
      {RAIL_FIELDS.map(({ field, id, name, labelKey, hintKey, unit }) => {
        const override = state.railOverrides[field];
        const fileValue = defaults?.[field] ?? null;
        const overridden = override !== undefined;
        const label = t(labelKey);
        const value = hasFile ? (override ?? fileValue) : null;
        let hint: ReactNode = hintKey ? t(hintKey) : undefined;
        // OpenRocket measures the rail angle from vertical (S12d): a second
        // line with the same angle in its convention, from the field's value.
        if (field === "inclination" && value !== null) {
          const fromVertical = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(
            Math.round((90 - value) * 10) / 10 + 0,
          );
          hint = (
            <>
              <span className="block">{hint}</span>
              <span className="block">{t("workbench.railInclinationOpenRocket", { value: fromVertical })}</span>
            </>
          );
        }
        return (
          <Field
            key={field}
            label={label}
            htmlFor={id}
            hint={hint}
            error={errorFor(errors, `rail.${field}`)}
            labelAside={
              hasFile &&
              (overridden ? (
                <>
                  <span className={cn(badge, "bg-accent-soft text-accent-ink")}>{t("workbench.railOverridden")}</span>
                  <button type="button" className={textLink} onClick={() => resetRailOverride(field)}>
                    {t("workbench.railReset", { value: fileValue === null ? "—" : `${fileValue}${unit}` })}
                  </button>
                </>
              ) : (
                <span className={cn(badge, "bg-chip text-ink-2")}>{t("workbench.railFromOrk")}</span>
              ))
            }
          >
            <RailInput
              id={id}
              name={name}
              disabled={!hasFile}
              placeholder={hasFile ? undefined : t("workbench.railPlaceholder")}
              value={value}
              overridden={overridden}
              onValue={(value) => setRailOverride(field, value)}
              onClear={() => resetRailOverride(field)}
            />
          </Field>
        );
      })}
    </Section>
  );
}

/**
 * A number input that lets the user clear it while typing: the text is kept
 * locally while focused, every parseable value becomes the override at once,
 * and leaving the field empty drops the override (the file's value returns).
 */
function RailInput({
  value,
  overridden,
  onValue,
  onClear,
  ...props
}: {
  id: string;
  name: string;
  disabled: boolean;
  placeholder?: string;
  value: number | null;
  overridden: boolean;
  onValue: (value: number) => void;
  onClear: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  // The typed text wins only while it still agrees with the value (or is
  // being cleared); a Reset or a file switch shows the new value at once.
  const typing = editing !== null && (editing.trim() === "" || Number(editing) === value);
  const shown = typing ? editing : value === null ? "" : String(value);

  return (
    <TextInput
      {...props}
      type="number"
      inputMode="decimal"
      autoComplete="off"
      step="any"
      className={cn("h-9", overridden && "border-ink-2 bg-accent-soft")}
      value={shown}
      onChange={(e) => {
        const text = e.target.value;
        setEditing(text);
        const num = Number(text);
        if (text.trim() !== "" && Number.isFinite(num)) onValue(num);
      }}
      onBlur={() => {
        if (editing !== null && editing.trim() === "") onClear();
        setEditing(null);
      }}
    />
  );
}
