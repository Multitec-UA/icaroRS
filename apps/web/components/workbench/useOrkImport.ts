"use client";

/**
 * The Workbench's `.ork` import (S8, L14) as one small state machine kept
 * local to the Workbench — WizardProvider only learns the outcome through
 * `setExport`.
 *
 *   idle ──pick(file)──▶ choosing ──confirm(rocketId)──▶ converting ──▶ idle
 *     │                     │ cancel                        │ error
 *     │                     ▼                               ▼
 *     │                   idle                            failed ──cancel──▶ idle
 *     └──pick(file, rocketId)────────────────────────────▶ converting
 *
 * The destination (a new rocket, or one of the org's) is chosen BEFORE the
 * upload starts because `rocket_id` travels in the convert request (L14).
 * `pick` skips the question when the caller already knows the destination
 * (the rocket panel's own drop zone) or when the org has no rockets to
 * choose from. Nothing is ever inferred from the file name (L3).
 *
 * Error contract (RocketStep's, kept): 401 → handled globally; 422 → the
 * "not an OpenRocket file" message; 503 → the server's hint verbatim; other
 * API codes → t("errors.<code>"); anything Java-related is a warning, not a
 * failure of the user's file.
 */

import { useCallback, useState } from "react";
import { ApiError } from "@/lib/api";
import { useConvertMutation, useRocketsQuery } from "@/lib/queries";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { useT } from "@/components/i18n/LocaleProvider";

export type ImportPhase =
  | { kind: "idle" }
  | { kind: "choosing"; file: File }
  | { kind: "converting"; file: File; rocketId: string | null }
  | { kind: "failed"; file: File; message: string; tone: "error" | "warning" };

export interface OrkImport {
  phase: ImportPhase;
  /** True while POST /api/convert is in flight — Run is held meanwhile. */
  converting: boolean;
  /**
   * A file was chosen. With `rocketId` the destination is known and the
   * conversion starts at once (`null` = a new rocket). Without it the user is
   * asked where the file goes, unless the org has no rockets yet.
   */
  pick: (file: File, rocketId?: string | null) => void;
  /** Answer to "Where does this file go?" — starts the conversion. */
  confirm: (rocketId: string | null) => void;
  /** Discard the pending file (destination card) or dismiss a failure. */
  cancel: () => void;
}

/**
 * The API names a new rocket after the manifest, falling back to the file
 * name without its extension (S4) — mirrored here for the context button.
 */
export function rocketNameFor(file: File, manifest: Record<string, unknown>): string {
  const name = manifest["name"];
  return typeof name === "string" && name.trim() !== "" ? name : file.name.replace(/\.ork$/i, "");
}

function isOrk(file: File): boolean {
  return file.name.toLowerCase().endsWith(".ork");
}

export function useOrkImport(): OrkImport {
  const t = useT();
  const { setExport } = useWizardDraft();
  const rockets = useRocketsQuery();
  const { mutate } = useConvertMutation();
  const [phase, setPhase] = useState<ImportPhase>({ kind: "idle" });

  const orgHasNoRockets = rockets.isSuccess && rockets.data.length === 0;

  const start = useCallback(
    (file: File, rocketId: string | null) => {
      setPhase({ kind: "converting", file, rocketId });
      mutate(
        { file, rocketId },
        {
          onSuccess: ({ export_id, rocket_id, manifest }) => {
            // Attached to one of the org's rockets: the context names THAT
            // rocket (the destination the user chose), never the file's own
            // design name. A new rocket is named as the API names it.
            const destination = rockets.data?.find((r) => r.rocket_id === rocket_id);
            setExport(export_id, manifest, rocket_id, {
              filename: file.name,
              rocketName: destination?.name ?? rocketNameFor(file, manifest),
            });
            setPhase({ kind: "idle" });
          },
          onError: (err) => {
            if (err instanceof ApiError && err.isUnauthorized) {
              // lib/query-client.ts logs the user out; nothing to show here.
              setPhase({ kind: "idle" });
              return;
            }
            let message: string;
            if (err instanceof ApiError && err.isValidation) message = t("rocket.errorNotOrk");
            else if (err instanceof ApiError) message = err.hint ?? t(`errors.${err.code}`, { status: err.status });
            else message = t("rocket.errorGeneric");
            setPhase({
              kind: "failed",
              file,
              message,
              tone: message.toLowerCase().includes("java") ? "warning" : "error",
            });
          },
        },
      );
    },
    [mutate, rockets.data, setExport, t],
  );

  const pick = useCallback(
    (file: File, rocketId?: string | null) => {
      if (!isOrk(file)) {
        setPhase({ kind: "failed", file, message: t("rocket.errorNotOrk"), tone: "error" });
        return;
      }
      if (rocketId !== undefined) {
        start(file, rocketId);
        return;
      }
      if (orgHasNoRockets) {
        start(file, null);
        return;
      }
      setPhase({ kind: "choosing", file });
    },
    [orgHasNoRockets, start, t],
  );

  const confirm = useCallback(
    (rocketId: string | null) => {
      if (phase.kind !== "choosing") return;
      start(phase.file, rocketId);
    },
    [phase, start],
  );

  const cancel = useCallback(() => setPhase({ kind: "idle" }), []);

  return { phase, converting: phase.kind === "converting", pick, confirm, cancel };
}
