"use client";

/**
 * Launch rail (S4) — length, inclination and heading, prefilled from the
 * active file's own values (`manifest.flight`, already converted by the
 * serializer to RocketPy's inclination from horizontal).
 *
 * Each field shows the file's value with a "From .ork" badge until the user
 * types over it; then it shows "Overridden" and a "Reset to …" link that
 * deletes the override. Only overrides are stored in the draft and sent to
 * /api/simulate (see `buildScenarioBody`), so a Reset truly resets and a
 * file switch never carries the previous file's values silently. With no
 * file loaded the fields are disabled with a "From your .ork" placeholder.
 */

import { useState } from "react";
import type { FieldError } from "@/lib/api";
import { useWizardDraft, type RailField } from "@/components/wizard/WizardProvider";
import { Field, TextInput } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
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

const badge = "rounded-full px-2 py-0.5 text-[11px] font-semibold";

export function LaunchRailSection({ errors }: { errors: FieldError[] }) {
  const t = useT();
  const { state, setRailOverride, resetRailOverride } = useWizardDraft();
  const defaults = state.railDefaults;
  const hasFile = state.exportId !== null;

  return (
    <Section title={t("workbench.launchRail")} index={2}>
      {RAIL_FIELDS.map(({ field, id, name, labelKey, hintKey, unit }) => {
        const override = state.railOverrides[field];
        const fileValue = defaults?.[field] ?? null;
        const overridden = override !== undefined;
        return (
          <Field
            key={field}
            label={t(labelKey)}
            htmlFor={id}
            hint={hintKey ? t(hintKey) : undefined}
            error={errorFor(errors, `rail.${field}`)}
          >
            <RailInput
              id={id}
              name={name}
              disabled={!hasFile}
              placeholder={hasFile ? undefined : t("workbench.railPlaceholder")}
              value={hasFile ? (override ?? fileValue) : null}
              overridden={overridden}
              onValue={(value) => setRailOverride(field, value)}
              onClear={() => resetRailOverride(field)}
            />
            {hasFile && (
              <div className="flex items-center gap-2">
                {overridden ? (
                  <>
                    <span className={cn(badge, "bg-accent-soft text-accent-ink")}>{t("workbench.railOverridden")}</span>
                    <button type="button" className={cn(textLink, "ml-auto")} onClick={() => resetRailOverride(field)}>
                      {t("workbench.railReset", { value: fileValue === null ? "—" : `${fileValue}${unit}` })}
                    </button>
                  </>
                ) : (
                  <span className={cn(badge, "bg-chip text-ink-2")}>{t("workbench.railFromOrk")}</span>
                )}
              </div>
            )}
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
      className={cn("h-9", overridden && "border-accent bg-accent-soft")}
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
