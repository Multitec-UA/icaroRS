"use client";

/**
 * MonteCarloLauncher — "Dispersion" beside the Run button (S12): a small
 * panel saying what a dispersion run does (S15), the number of flights
 * (number field + slider, 10..500, default 100), an "≈ N min" estimate (~0.4 s per flight) and "Run dispersion".
 *
 * The count is clamped on blur and again on submit, so whatever is typed
 * the API receives a count it accepts. A launch the parent reports as queued
 * (anything but `false`) closes the panel; a refused one keeps it open with
 * its error. The deterministic Run button is a separate control and never
 * waits on this one.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  MC_DEFAULT_FLIGHTS,
  MC_MAX_FLIGHTS,
  MC_MIN_FLIGHTS,
  clampFlights,
  estimateMinutes,
} from "@/lib/domain/montecarlo";
import { Button, Spinner, buttonClass, inputClass, popoverClass } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn } from "@/lib/styles";

export function MonteCarloLauncher({
  disabledReason,
  submitting,
  error,
  onLaunch,
}: {
  /** Why it cannot launch now (no site, no date…), or null. */
  disabledReason: string | null;
  submitting: boolean;
  error: string | null;
  /** Resolves `false` when the launch was refused (the panel stays open). */
  onLaunch: (flights: number) => void | Promise<boolean | void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(String(MC_DEFAULT_FLIGHTS));
  const panelId = useId();
  const fieldId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const flights = clampFlights(Number(value));
  const blocked = disabledReason !== null || submitting;

  // Escape or a click outside closes the panel.
  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    function onPointer(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (blocked) return;
    setValue(String(flights));
    const queued = await onLaunch(flights);
    if (queued !== false) setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((current) => !current)}
        className={cn(buttonClass({ variant: "ghost" }), "shrink-0")}
      >
        {t("montecarlo.launch")}
      </button>
      {open && (
        <form
          id={panelId}
          aria-label={t("montecarlo.panelLabel")}
          onSubmit={submit}
          // The count is clamped on submit; the browser's range check would block it instead.
          noValidate
          className={cn(popoverClass, "absolute right-0 top-full z-30 mt-2 flex w-72 flex-col gap-3 p-4")}
        >
          <p className="text-xs text-muted">{t("montecarlo.panelHint", { count: flights })}</p>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={fieldId} className="text-xs font-medium text-ink-2">
              {t("montecarlo.flights")}
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                aria-label={t("montecarlo.flightsSlider")}
                min={MC_MIN_FLIGHTS}
                max={MC_MAX_FLIGHTS}
                step={10}
                value={flights}
                onChange={(event) => setValue(event.target.value)}
                className="min-w-0 flex-1 accent-[var(--accent)]"
              />
              <input
                id={fieldId}
                type="number"
                inputMode="numeric"
                min={MC_MIN_FLIGHTS}
                max={MC_MAX_FLIGHTS}
                step={1}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onBlur={() => setValue(String(flights))}
                className={cn(inputClass, "w-20 tabular-nums")}
              />
            </div>
            <span className="text-xs tabular-nums text-muted">
              {t("montecarlo.flightsHint", {
                min: MC_MIN_FLIGHTS,
                max: MC_MAX_FLIGHTS,
                minutes: estimateMinutes(flights),
              })}
            </span>
          </div>
          {disabledReason && <p className="text-xs text-muted">{disabledReason}</p>}
          {error && (
            <p role="alert" className="text-xs text-bad-ink">
              {error}
            </p>
          )}
          <Button type="submit" disabled={blocked}>
            {submitting && <Spinner decorative className="h-3.5 w-3.5" />}
            {submitting ? t("montecarlo.submitting") : t("montecarlo.run")}
          </Button>
        </form>
      )}
    </div>
  );
}
