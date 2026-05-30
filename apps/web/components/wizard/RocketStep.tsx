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
import { Button, Callout, Spinner } from "@/components/ui";

type Status = "idle" | "loading" | "done" | "error";

export function RocketStep() {
  const { state, setExport, next } = useWizard();
  const { logout } = useAuth();
  const [status, setStatus] = useState<Status>(state.exportId ? "done" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".ork")) {
      setStatus("error");
      setError("That isn't an OpenRocket file. Please choose a .ork file.");
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
      setError(err instanceof Error ? err.message : "Conversion failed.");
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }

  const rocketName =
    (state.manifest?.["name"] as string | undefined) ?? filename ?? "your rocket";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Upload your rocket</h2>
        <p className="mt-1 text-sm text-slate-500">
          Drop the OpenRocket <code className="rounded bg-slate-100 px-1">.ork</code> file
          you designed. We convert it into a simulation-ready model.
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
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-slate-50 hover:bg-slate-100",
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
          <div className="flex items-center gap-2 text-sky-700">
            <Spinner />
            <span>Converting {filename}… this can take up to a minute.</span>
          </div>
        ) : status === "done" ? (
          <div className="text-emerald-700">
            <p className="text-2xl">✓</p>
            <p className="font-medium">Ready: {rocketName}</p>
            <p className="text-sm text-slate-500">Click to choose a different file.</p>
          </div>
        ) : (
          <>
            <p className="text-3xl">🚀</p>
            <p className="font-medium text-slate-700">
              Drag &amp; drop your .ork file here
            </p>
            <p className="text-sm text-slate-500">or click to browse</p>
          </>
        )}
      </div>

      {status === "error" && error && (
        <Callout tone={error.toLowerCase().includes("java") ? "warning" : "error"}>
          {error}
        </Callout>
      )}

      <div className="flex justify-end">
        <Button onClick={next} disabled={status !== "done"}>
          Continue →
        </Button>
      </div>
    </div>
  );
}
