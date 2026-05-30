"use client";

/**
 * Step 4 — Review & run. Shows a plain-language summary of the scenario, then
 * runs /api/simulate. The simulation is synchronous and can take a while; on
 * success we navigate to the shareable results page.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, simulate, type FieldError } from "@/lib/api";
import { useWizard, toLaunchDate } from "./WizardProvider";
import { useAuth } from "@/components/auth/AuthGate";
import { Button, Callout, Spinner } from "@/components/ui";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 text-sm last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{value}</span>
    </div>
  );
}

export function ReviewStep() {
  const { state, setResult, scenarioBody } = useWizard();
  const { logout } = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [fatal, setFatal] = useState<string | null>(null);

  async function run() {
    if (!state.exportId) return;
    setBusy(true);
    setErrors([]);
    setFatal(null);
    try {
      const result = await simulate(state.exportId, scenarioBody());
      setResult(result);
      router.push(`/results/${encodeURIComponent(result.run_id)}`);
    } catch (err) {
      if (err instanceof ApiError && err.isUnauthorized) return logout();
      if (err instanceof ApiError && err.isValidation) setErrors(err.fieldErrors ?? []);
      else setFatal(err instanceof Error ? err.message : "Simulation failed.");
      setBusy(false);
    }
  }

  const date = toLaunchDate(state.launchDatetime);
  const site = state.site;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">Review &amp; launch</h2>
        <p className="mt-1 text-sm text-slate-500">
          Check the summary, then run the simulation.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <Row label="Scenario" value={state.name} />
        <Row
          label="Site"
          value={
            site && Number.isFinite(site.latitude)
              ? `${site.latitude.toFixed(4)}, ${site.longitude.toFixed(4)}${
                  site.elevation !== null ? ` · ${site.elevation} m` : ""
                }`
              : "—"
          }
        />
        <Row
          label="Launch time (UTC)"
          value={
            date
              ? `${date.year}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")} ${String(date.hour).padStart(2, "0")}:00`
              : "—"
          }
        />
        <Row label="Atmosphere" value={state.atmosphere.model} />
        <Row
          label="Uncertainty params"
          value={state.uncertainty ? String(Object.keys(state.uncertainty).length) : "default"}
        />
      </div>

      {errors.length > 0 && (
        <Callout tone="error" title="The scenario needs attention">
          <ul className="list-disc pl-5">
            {errors.map((e, i) => (
              <li key={i}>
                {e.field ? `${e.field}: ` : ""}
                {e.message}
              </li>
            ))}
          </ul>
        </Callout>
      )}
      {fatal && <Callout tone="error">{fatal}</Callout>}

      <div className="flex items-center justify-end gap-3">
        {busy && (
          <span className="text-sm text-slate-500">
            Running the 6-DOF simulation — this can take a moment…
          </span>
        )}
        <Button onClick={run} disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Simulating…" : "Run simulation 🚀"}
        </Button>
      </div>
    </div>
  );
}
