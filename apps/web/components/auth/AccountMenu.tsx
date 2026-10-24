"use client";

/**
 * AccountMenu — the round avatar at the top-right of the nav, and the panel
 * it opens: who is signed in (email + organization), the language switch,
 * "Change password" and "Sign out".
 *
 * A disclosure (button + panel), not an ARIA `menu`: the panel mixes
 * read-only details with a toggle group and buttons, which a `menu` role
 * (menuitems only, arrow-key navigation) would misdescribe. It closes on
 * Escape, returning focus to the avatar, and on a pointer press outside.
 *
 * "Change password" starts Firebase's built-in flow (lib/firebase.ts's
 * sendPasswordReset): Identity Platform emails the signed-in address a link
 * to its hosted page. The app never sees or handles the new password.
 *
 * The avatar is the same generic silhouette for everyone for now.
 */

import { useEffect, useId, useRef, useState } from "react";
import { useAuth } from "@/components/auth/AuthGate";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { sendPasswordReset } from "@/lib/firebase";
import { cn, focusRing } from "@/lib/styles";

type ResetStatus = "idle" | "sending" | "sent" | "failed";

function AvatarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={className}>
      <circle cx="16" cy="16" r="16" className="fill-white/[0.08]" />
      <circle cx="16" cy="12.5" r="5" className="fill-white/55" />
      <path d="M6.5 26.5a9.5 9.5 0 0 1 19 0" className="fill-white/55" />
    </svg>
  );
}

const actionClassName = cn(
  "w-full rounded-xl px-3 py-2 text-left text-sm transition-colors duration-300 ease-[var(--ease-spring)] hover:bg-white/[0.06] disabled:pointer-events-none disabled:opacity-40",
  focusRing,
);

export function AccountMenu() {
  const t = useT();
  const { locale } = useLocale();
  const { identity, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [resetStatus, setResetStatus] = useState<ResetStatus>("idle");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  async function changePassword() {
    if (!identity.email) return;
    setResetStatus("sending");
    try {
      await sendPasswordReset(identity.email, locale);
      setResetStatus("sent");
    } catch {
      setResetStatus("failed");
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={t("account.open")}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-inset ring-white/15 transition-[box-shadow,transform] duration-300 ease-[var(--ease-spring)] hover:ring-white/30 active:scale-[0.96]",
          focusRing,
        )}
      >
        <AvatarIcon className="h-8 w-8" />
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute right-0 top-11 w-72 max-w-[calc(100vw-2rem)] rounded-2xl bg-[#0b0b0d]/95 p-2 ring-1 ring-inset ring-white/10 shadow-[0_12px_48px_rgba(0,0,0,0.6)] backdrop-blur-md"
        >
          <div className="flex items-center gap-3 px-3 py-3">
            <AvatarIcon className="h-10 w-10 shrink-0" />
            <div className="flex min-w-0 flex-col gap-0.5">
              {identity.email && (
                <span translate="no" className="truncate text-sm font-medium text-foreground">
                  {identity.email}
                </span>
              )}
              <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
                <span className="text-muted">{t("account.organization")}</span>
                <span translate="no" className="truncate font-medium text-foreground">
                  {identity.org_id}
                </span>
              </span>
            </div>
          </div>

          <div className="my-1 h-px bg-white/10" />

          <div className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-muted">{t("nav.language")}</span>
            <LanguageSwitch />
          </div>

          <div className="flex items-center justify-between px-3 py-2 text-sm">
            <span className="text-muted">{t("theme.label")}</span>
            <ThemeToggle />
          </div>

          <div className="my-1 h-px bg-white/10" />

          <button
            type="button"
            onClick={changePassword}
            disabled={!identity.email || resetStatus === "sending"}
            className={cn(actionClassName, "text-foreground")}
          >
            {resetStatus === "sending" ? t("account.changePasswordSending") : t("account.changePassword")}
          </button>
          {resetStatus === "sent" && identity.email && (
            <p role="status" className="px-3 pb-2 text-xs text-emerald-400">
              {t("account.changePasswordSent", { email: identity.email })}
            </p>
          )}
          {resetStatus === "failed" && (
            <p role="alert" className="px-3 pb-2 text-xs text-rose-400">
              {t("account.changePasswordFailed")}
            </p>
          )}

          <button type="button" onClick={logout} className={cn(actionClassName, "text-rose-300")}>
            {t("account.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
