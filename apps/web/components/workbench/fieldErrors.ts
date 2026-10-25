/**
 * Field-error plumbing shared by the Workbench's input sections.
 *
 * /api/simulate answers a 422 with `FieldError[]` whose `field` is a dotted
 * scenario path ("site.latitude", "rail.length", "date"). Each input section
 * shows the error of its own fields inline; whatever matches no input on the
 * Workbench (a general error, or a field the UI does not expose) is listed in
 * the results column instead, so nothing the API said is dropped.
 */

import type { FieldError } from "@/lib/api";

/** Scenario field path → input id, in DOM order, for every Workbench input. */
export const FIELD_INPUTS: ReadonlyArray<readonly [path: string, inputId: string]> = [
  ["site.latitude", "lat"],
  ["site.longitude", "lon"],
  ["site.elevation", "elev"],
  ["date", "dt"],
  ["atmosphere.station", "station"],
  ["atmosphere.file", "file"],
  ["rail.length", "rl"],
  ["rail.inclination", "ri"],
  ["rail.heading", "rh"],
];

export function matchesField(prefix: string, field: string): boolean {
  return field === prefix || field.startsWith(`${prefix}.`);
}

/** The message to show inline for `prefix`, if the API reported one. */
export function errorFor(errors: FieldError[], prefix: string): string | undefined {
  return errors.find((e) => matchesField(prefix, e.field))?.message;
}

/** Errors no Workbench input displays inline (general or unexposed fields). */
export function unplacedErrors(errors: FieldError[]): FieldError[] {
  return errors.filter((e) => !FIELD_INPUTS.some(([path]) => matchesField(path, e.field)));
}

/**
 * Move focus to the first input whose field errored, opening the disclosure
 * that may hide it — the same courtesy the wizard steps extended.
 */
export function focusFirstError(errors: FieldError[]): void {
  const first = FIELD_INPUTS.find(([path]) => errors.some((e) => matchesField(path, e.field)));
  const el = first ? document.getElementById(first[1]) : null;
  if (!el) return;
  const section = el.closest("details");
  if (section) section.open = true;
  el.focus();
}
