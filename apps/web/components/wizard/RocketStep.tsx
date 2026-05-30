"use client";

/**
 * Step 1 — Rocket. Upload an OpenRocket .ork file; we POST it to /api/convert
 * which returns an export_id used by the simulation. States: idle / loading /
 * done / error. Conversion runs a JVM subprocess server-side, so it can take a
 * moment — we say so rather than pretending it's instant.
 */

import { useRef, useState, type DragEvent } from "react";
import { ApiError, convert } from "@/lib/api";
import { useWizard } from "./WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { Button, Callout, Eyebrow, Spinner } from "@/components/ui";
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
  const inputRef = useRef<HTMLInputElement>(null);

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
      const { export_id, manifest } = await convert(file);
      setExport(export_id, manifest);
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

  function onDrop(e: DragEvent<HTMLDivElement>) {
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
        <h2 className="text-2xl font-semibold tracking-tight">{t("rocket.heading")}</h2>
        <p className="text-sm text-muted">
          {t("rocket.description")}
        </p>
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={[
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-6 py-14 text-center transition-all duration-500 ease-[var(--ease-spring)]",
          dragging
            ? "border-cyan-400/60 bg-cyan-400/[0.06] shadow-[0_0_40px_-12px_rgba(34,211,238,0.5)]"
            : "border-white/15 bg-white/[0.02] hover:border-white/25 hover:bg-white/[0.04]",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".ork"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        {status === "loading" ? (
          <div className="flex items-center gap-2 text-cyan-300">
            <Spinner />
            <span>{t("rocket.converting", { filename: filename ?? "" })}</span>
          </div>
        ) : status === "done" ? (
          <div className="flex flex-col items-center gap-1">
            <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-400/15 text-2xl text-cyan-300 ring-1 ring-cyan-400/30">
              ✓
            </span>
            <p className="font-medium text-foreground">{t("rocket.readyPrefix", { name: rocketName })}</p>
            <p className="text-sm text-muted">{t("rocket.changeFile")}</p>
          </div>
        ) : (
          <>
            <p className="text-3xl">🚀</p>
            <p className="font-medium text-foreground">
              {t("rocket.dropPrompt")}
            </p>
            <p className="text-sm text-muted">{t("rocket.browsePrompt")}</p>
          </>
        )}
      </div>

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
