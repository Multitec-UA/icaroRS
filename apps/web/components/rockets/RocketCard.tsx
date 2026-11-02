"use client";

/**
 * One rocket of the /rockets list — the interactive island inside the
 * server-rendered RocketsListServer (issue #52, on the theme tokens since
 * S9). A rocket groups the .ork files (exports) uploaded for it.
 *
 * "Use this rocket" finds the rocket's newest export and opens the
 * Workbench at `/?file={export_id}` (S8): the Workbench loads the file from
 * its URL, so the link survives a refresh and NO .ork is re-uploaded. Owns its own
 * mutation state (issue #50) so a failure shows an inline error without
 * affecting any other card. "Runs" opens the comparison board filtered to
 * this rocket.
 *
 * The pencil next to the name renames the rocket in place (PATCH
 * /api/rockets/{id}): Enter or Save stores it, Escape or Cancel drops the
 * edit, and a failure keeps the editor open with the typed name. The card
 * shows the saved name at once and refreshes the server-rendered list.
 *
 * The date goes through Intl with the app locale and a fixed UTC zone: the
 * card is server-rendered first, so the string must not depend on the
 * browser's zone or hydration would mismatch.
 */

import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiError, type RocketSummary } from "@/lib/api";
import { useRenameRocketMutation, useRocketNewestExportMutation } from "@/lib/queries";
import { Spinner, buttonClass, cardClass, ghostButton, inputClass, textLink } from "@/components/ui";
import { cn, focusRing } from "@/lib/styles";
import { Reveal } from "@/components/motion";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { PencilIcon, RocketIcon } from "@/components/workbench/icons";

/** Same limit as the API's RocketRename (apps/api routers/rockets.py). */
const MAX_NAME_LENGTH = 120;

export function RocketCard({ rocket, index = 0 }: { rocket: RocketSummary; index?: number }) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const useRocket = useRocketNewestExportMutation();
  const rename = useRenameRocketMutation();
  // The saved name until the server-rendered list catches up with it.
  const [savedName, setSavedName] = useState<string | null>(null);
  const [draftName, setDraftName] = useState<string | null>(null);
  const name = savedName ?? rocket.name;
  const editing = draftName !== null;
  const trimmed = draftName?.trim() ?? "";

  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" }),
    [locale],
  );

  const isLoadingDetail = useRocket.isPending;
  const isUnauthorizedError = useRocket.error instanceof ApiError && useRocket.error.isUnauthorized;
  const hasError = useRocket.isError && !isUnauthorizedError;

  function startEditing() {
    rename.reset();
    setDraftName(name);
  }

  function cancelEditing() {
    rename.reset();
    setDraftName(null);
  }

  function handleRename(event: FormEvent) {
    event.preventDefault();
    if (!trimmed || rename.isPending) return;
    if (trimmed === name) {
      cancelEditing();
      return;
    }
    rename.mutate(
      { rocketId: rocket.rocket_id, name: trimmed },
      {
        onSuccess: (updated) => {
          setSavedName(updated.name);
          setDraftName(null);
          router.refresh();
        },
      },
    );
  }

  function handleEditorKey(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditing();
    }
  }

  const renameUnauthorized = rename.error instanceof ApiError && rename.error.isUnauthorized;
  const renameFailed = rename.isError && !renameUnauthorized;

  function handleUseRocket() {
    useRocket.mutate(rocket.rocket_id, {
      onSuccess: (newest) => router.push(`/?file=${encodeURIComponent(newest.export_id)}`),
    });
  }

  return (
    // Stagger is capped so a long list doesn't keep its last rows waiting.
    <Reveal delay={Math.min(index, 10) * 0.04} className="h-full">
      <article className={cn("flex h-full flex-col gap-4 p-5", cardClass)}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"
          >
            <RocketIcon />
          </span>
          {editing ? (
            <form onSubmit={handleRename} className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <input
                autoFocus
                aria-label={t("rockets.nameLabel")}
                value={draftName}
                maxLength={MAX_NAME_LENGTH}
                disabled={rename.isPending}
                aria-invalid={trimmed === "" || undefined}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={handleEditorKey}
                className={cn(inputClass, "min-w-40 flex-1")}
              />
              <button
                type="submit"
                disabled={!trimmed || rename.isPending}
                className={buttonClass({ variant: "primary", size: "sm" })}
              >
                {rename.isPending && <Spinner decorative className="h-3.5 w-3.5" />}
                {t("rockets.renameSave")}
              </button>
              <button
                type="button"
                disabled={rename.isPending}
                onClick={cancelEditing}
                className={buttonClass({ variant: "ghost", size: "sm" })}
              >
                {t("common.cancel")}
              </button>
            </form>
          ) : (
            <>
              <h2 className="min-w-0 flex-1 break-words text-base font-semibold text-ink">{name}</h2>
              <button
                type="button"
                onClick={startEditing}
                aria-label={t("rockets.renameLabel", { rocket: name })}
                title={t("rockets.rename")}
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-300 hover:bg-surface-2 hover:text-ink pointer-coarse:h-11 pointer-coarse:w-11",
                  focusRing,
                )}
              >
                <PencilIcon />
              </button>
            </>
          )}
        </div>

        {renameFailed && (
          <p aria-live="polite" className="text-xs text-bad-ink">
            {t("rockets.errorRenameFailed")}
          </p>
        )}

        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted">{t("rockets.colBy")}</dt>
            {/* An identifier (email / user id): never machine-translated. */}
            <dd translate="no" className="break-words text-ink-2">
              {rocket.created_by}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted">{t("rockets.colDate")}</dt>
            <dd className="tabular-nums text-ink-2">{dateFormat.format(new Date(rocket.created_at))}</dd>
          </div>
        </dl>

        {hasError && (
          <p aria-live="polite" className="text-xs text-bad-ink">
            {t("rockets.errorUseFailed")}
          </p>
        )}

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
          <Link href={`/runs?rocket_id=${encodeURIComponent(rocket.rocket_id)}`} className={textLink}>
            {t("rockets.runs")}
          </Link>
          <button type="button" disabled={isLoadingDetail} onClick={handleUseRocket} className={ghostButton}>
            {isLoadingDetail && <Spinner decorative className="h-3.5 w-3.5 text-accent-ink" />}
            {t("rockets.useThisRocket")}
          </button>
        </div>
      </article>
    </Reveal>
  );
}
