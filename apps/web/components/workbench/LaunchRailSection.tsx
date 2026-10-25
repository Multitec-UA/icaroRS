"use client";

/**
 * Launch rail — optional overrides of the rail length, inclination and
 * heading. Empty fields mean "use the .ork's own values": the draft's `rail`
 * stays null until one of them is filled. Same rule the wizard's
 * AdvancedStep applied.
 */

import type { FieldError } from "@/lib/api";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { Field, TextInput } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { errorFor } from "./fieldErrors";
import { Section } from "./Section";

type RailField = "length" | "inclination" | "heading";

const RAIL_FIELDS: ReadonlyArray<{ field: RailField; id: string; name: string; labelKey: `advanced.rail${string}` }> = [
  { field: "length", id: "rl", name: "rail-length", labelKey: "advanced.railLength" },
  { field: "inclination", id: "ri", name: "rail-inclination", labelKey: "advanced.railInclination" },
  { field: "heading", id: "rh", name: "rail-heading", labelKey: "advanced.railHeading" },
];

export function LaunchRailSection({ errors }: { errors: FieldError[] }) {
  const t = useT();
  const { state, setRail } = useWizardDraft();

  function editRail(field: RailField, value: string) {
    const num = value === "" ? null : Number(value);
    const base = state.rail ?? { length: null, inclination: null, heading: null };
    const nextRail = { ...base, [field]: num };
    const allEmpty =
      nextRail.length === null && nextRail.inclination === null && nextRail.heading === null;
    setRail(allEmpty ? null : nextRail);
  }

  return (
    <Section title={t("workbench.launchRail")} index={2}>
      <div className="grid grid-cols-3 gap-2">
        {RAIL_FIELDS.map(({ field, id, name, labelKey }) => (
          <Field key={field} label={t(labelKey)} htmlFor={id} error={errorFor(errors, `rail.${field}`)}>
            <TextInput
              id={id}
              name={name}
              type="number"
              inputMode="decimal"
              autoComplete="off"
              step="any"
              className="h-9"
              value={state.rail?.[field] ?? ""}
              onChange={(e) => editRail(field, e.target.value)}
            />
          </Field>
        ))}
      </div>
    </Section>
  );
}
