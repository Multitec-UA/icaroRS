"use client";

/**
 * WorkbenchShell — the screen at `/` (S7, canvas board A): sidebar, a surface
 * card with the command row (TopBar), the inputs column and the results
 * column. Replaces the 4-step wizard as the main screen while reusing its
 * domain logic (lib/domain/scenario.ts via WizardProvider) and API layer.
 *
 * Two pieces of screen-level state live here and are handed down as props:
 *   - the `.ork` import (useOrkImport, S8): drop zone → destination →
 *     converting, shared by the results column (cards), the top bar
 *     (context + Run held while converting) and the rocket panel;
 *   - the Run action (useRunSimulation, S7), reachable three ways with one
 *     implementation: the TopBar button, ⌘↵ / Ctrl+Enter anywhere on the
 *     page, and the rocket panel's switch to another file ("Run this file").
 */

import { useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { InputsPanel } from "./InputsPanel";
import { ResultsColumn } from "./ResultsColumn";
import { useOrkImport } from "./useOrkImport";
import { useRunSimulation } from "./useRunSimulation";

export function WorkbenchShell() {
  const importer = useOrkImport();
  const simulation = useRunSimulation({ hold: importer.converting });
  const { run, ready } = simulation;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter" || !(event.metaKey || event.ctrlKey)) return;
      if (!ready) return;
      event.preventDefault();
      void run();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [ready, run]);

  return (
    <div className="flex w-full flex-1 flex-col lg:flex-row">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col p-3 lg:pl-0">
        <div className="flex flex-1 flex-col rounded-2xl border border-border bg-surface shadow-soft">
          <TopBar simulation={simulation} importer={importer} />
          <div className="flex flex-1 flex-col lg:flex-row">
            <InputsPanel errors={simulation.errors} />
            <ResultsColumn errors={simulation.errors} fatal={simulation.fatal} importer={importer} />
          </div>
        </div>
      </div>
    </div>
  );
}
