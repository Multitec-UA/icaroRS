/**
 * The Workbench draft kept in `sessionStorage` (S12l), so edits made after a
 * run survive a refresh: the URL (`/?run={id}`) only names the run, and
 * re-reading it would otherwise reset the inputs to the run's own scenario.
 *
 * One entry per export, under `icaro:draft:{exportId}`: the scenario fields
 * the user edits (site, launch time, atmosphere, rail overrides) and the run
 * they were editing from (`runId`, null before any run). Session scope keeps
 * it to this tab; "Start fresh" clears every entry. Storage that is missing,
 * full or blocked is ignored: the draft then just lives in memory as before.
 */

import type { Atmosphere, Site } from "@/lib/api";
import type { RailOverrides } from "@/lib/domain/scenario";

export interface StoredDraft {
  /** The displayed run the edits started from; null when none was displayed. */
  runId: string | null;
  site: Site | null;
  launchDatetime: string | null;
  atmosphere: Atmosphere;
  railOverrides: RailOverrides;
}

const PREFIX = "icaro:draft:";

export function draftKey(exportId: string): string {
  return `${PREFIX}${exportId}`;
}

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStoredDraft(value: unknown): value is StoredDraft {
  return (
    isRecord(value) &&
    (value.runId === null || typeof value.runId === "string") &&
    (value.site === null || isRecord(value.site)) &&
    (value.launchDatetime === null || typeof value.launchDatetime === "string") &&
    isRecord(value.atmosphere) &&
    isRecord(value.railOverrides)
  );
}

/** Store the draft of `exportId`, replacing the previous one. */
export function saveDraft(exportId: string, draft: StoredDraft): void {
  try {
    storage()?.setItem(draftKey(exportId), JSON.stringify(draft));
  } catch {
    // Full or blocked storage: the draft stays in memory only.
  }
}

/** The stored draft of `exportId`, or null when none (or an unreadable one) is stored. */
export function loadDraft(exportId: string): StoredDraft | null {
  try {
    const raw = storage()?.getItem(draftKey(exportId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return isStoredDraft(value) ? value : null;
  } catch {
    return null;
  }
}

/** Forget every stored draft ("Start fresh"). */
export function clearDrafts(): void {
  try {
    const store = storage();
    if (!store) return;
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index)).filter(
      (key): key is string => key?.startsWith(PREFIX) ?? false,
    );
    keys.forEach((key) => store.removeItem(key));
  } catch {
    // Blocked storage holds nothing to clear.
  }
}
