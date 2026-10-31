"use client";

/**
 * Toast — a short message about something that finished elsewhere (S8: a
 * run that resolves after the user left the Workbench). A module-level
 * store, so any code path can raise one without a provider: `showToast`
 * adds, `dismissToast` removes, and `<Toaster />` (mounted once by the
 * AppShell) renders the queue, each toast a polite `role="status"` region
 * (none while the queue is empty, so pages keep their own status regions).
 *
 * Each toast dismisses itself after `TOAST_TIMEOUT_MS` (8 s). It appears
 * without animation, so reduced motion needs no special case. Tones reuse
 * the kit's soft fill + ink tokens.
 */

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { cn, focusRing } from "@/lib/styles";
import { textLink, toneClass } from "./classes";

export const TOAST_TIMEOUT_MS = 8000;

export interface ToastInput {
  tone: "ok" | "bad";
  message: string;
  /** Optional link shown after the message. */
  action?: { href: string; label: string };
}

export interface ToastItem extends ToastInput {
  id: number;
}

let toasts: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Queue a toast; returns its id. */
export function showToast(input: ToastInput): number {
  const id = nextId++;
  toasts = [...toasts, { ...input, id }];
  emit();
  return id;
}

export function dismissToast(id: number): void {
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** Drop every toast (tests). */
export function clearToasts(): void {
  toasts = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: ToastItem[] = [];

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    subscribe,
    () => toasts,
    () => EMPTY,
  );
}

function ToastCard({ toast, dismissLabel }: { toast: ToastItem; dismissLabel: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismissToast(toast.id), TOAST_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [toast.id]);

  return (
    <li
      role="status"
      className={cn(
        "pointer-events-auto flex items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm shadow-soft-lg",
        toneClass[toast.tone],
      )}
    >
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      {toast.action && (
        <Link href={toast.action.href} onClick={() => dismissToast(toast.id)} className={cn(textLink, "shrink-0")}>
          {toast.action.label}
        </Link>
      )}
      <button
        type="button"
        aria-label={dismissLabel}
        onClick={() => dismissToast(toast.id)}
        className={cn("shrink-0 rounded-md px-1 text-current opacity-70 hover:opacity-100", focusRing)}
      >
        ×
      </button>
    </li>
  );
}

/** The toast queue, bottom-right; mount once. */
export function Toaster({ dismissLabel }: { dismissLabel: string }) {
  const items = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[1200] w-[min(360px,calc(100vw-2rem))]">
      <ul className="flex flex-col gap-2">
        {items.map((toast) => (
          <ToastCard key={toast.id} toast={toast} dismissLabel={dismissLabel} />
        ))}
      </ul>
    </div>
  );
}
