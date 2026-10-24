"use client";

/**
 * Step 1 — Rocket. Upload an OpenRocket .ork file; we POST it to /api/convert
 * which returns an export_id used by the simulation. States: idle / loading /
 * done / error. Conversion runs a JVM subprocess server-side, so it can take a
 * moment — we say so rather than pretending it's instant.
 */

import { useId, useState, type DragEvent } from "react";
import { ApiError, convert } from "@/lib/api";
import { useWizard } from "./WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { Button, Callout, Eyebrow, Spinner } from "@/components/ui";
import { cn } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";

type Status = "idle" | "loading" | "done" | "error";

export function RocketStep() {
  const { state, setExport, next } = useWizard();
  const { logout } = useAuth();
  const t = useT();
  const [status, setStatus] = useState<Status>(state.exportId ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputId = useId();

  async function handleFile(file: File) {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".ork")) {
      setStatus("error");
      setError(t("rocket.errorNotOrk"));
      return;
    }
    setFilename(file.name);
    setStatus("loading");
    try {
      const { export_id, rocket_id, manifest } = await convert(file);
      setExport(export_id, manifest, rocket_id);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      if (err instanceof ApiError && err.isUnauthorized) {
        logout();
        return;
      }
      if (err instanceof ApiError)
        // Prefer server hint verbatim (503 service note) per design; otherwise map code to catalog key.
        setError(err.hint ?? t(`errors.${err.code}`, { status: err.status }));
      else setError(t("rocket.errorGeneric"));
    }
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const rocketName =
    (state.manifest?.["name"] as string | undefined) ?? filename ?? t("rocket.defaultRocketName");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>{t("rocket.eyebrow")}</Eyebrow>
        <h2
          tabIndex={-1}
          className="text-balance text-2xl font-semibold tracking-tight outline-none focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-cyan-400/40"
        >
          {t("rocket.heading")}
        </h2>
        <p className="text-sm text-muted">
          {t("rocket.description")}
        </p>
      </div>

      {/* The dropzone IS the file input's label: clicking or activating it
          opens the native picker, and the sr-only input stays in the tab
          order, so keyboard users get the same path as mouse users. */}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-14 text-center transition-[border-color,background-color,box-shadow] duration-500 ease-[var(--ease-spring)]",
          "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-400/60 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background",
          dragging
            ? "border-cyan-400/60 bg-cyan-400/[0.06] shadow-[0_0_40px_-12px_rgba(34,211,238,0.5)]"
            : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]",
        )}
      >
        <input
          id={inputId}
          name="rocket-file"
          type="file"
          accept=".ork"
          className="sr-only"
          aria-label={t("rocket.fileInputLabel")}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {/* One always-present live region so the converting → ready
            transition is announced without moving focus. */}
        <div aria-live="polite" className="flex min-w-0 max-w-full flex-col items-center gap-2">
          {status === "loading" ? (
            <div className="flex items-center gap-2 text-cyan-300">
              <Spinner decorative />
              <span className="break-words">{t("rocket.converting", { filename: filename ?? "" })}</span>
            </div>
          ) : status === "done" ? (
            <div className="flex min-w-0 max-w-full flex-col items-center gap-1">
              <span
                aria-hidden="true"
                className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400/15 text-2xl text-cyan-300 ring-1 ring-cyan-400/30"
              >
                ✓
              </span>
              <p className="max-w-full break-words font-medium text-foreground">
                {t("rocket.readyPrefix", { name: rocketName })}
              </p>
              <p className="text-sm text-muted">{t("rocket.changeFile")}</p>
            </div>
          ) : (
            <>
              <p aria-hidden="true" className="text-3xl">
                🚀
              </p>
              <p className="font-medium text-foreground">
                {t("rocket.dropPrompt")}
              </p>
              <p className="text-sm text-muted">{t("rocket.browsePrompt")}</p>
            </>
          )}
        </div>
      </label>

      {status === "error" && error && (
        <Callout tone={error.toLowerCase().includes("java") ? "warning" : "error"}>
          {error}
        </Callout>
      )}

      <div className="flex justify-end">
        <Button onClick={next} disabled={status !== "done"} withArrow={status === "done"}>
          {t("rocket.continue")}
        </Button>
      </div>
    </div>
  );
}
