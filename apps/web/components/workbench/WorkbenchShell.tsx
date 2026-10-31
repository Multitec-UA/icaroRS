"use client";

/**
 * WorkbenchShell — the screen at `/` (S7, canvas board A): a surface card
 * with the command row (TopBar), the inputs column and the results column.
 * The sidebar beside it belongs to the AppShell every route shares (T8b).
 *
 * Screen-level state lives here and is handed down as props:
 *   - the URL (useWorkbenchUrl, S8): `/?file=` / `/?run=` resolved into the
 *     draft on mount and kept in step with it; its loading and 404 states
 *     show in the results column and the top bar;
 *   - the `.ork` import (useOrkImport, S8/S9): drop zone → destination →
 *     converting, shared by the results column (cards), the top bar
 *     (context + Run held while converting), the rocket panel and the
 *     drop-anywhere overlay below;
 *   - the Run action (useRunSimulation, S7), reachable three ways with one
 *     implementation: the TopBar button, ⌘↵ / Ctrl+Enter anywhere on the
 *     page, and the rocket panel's switch to another file. Its `status`
 *     (S6) compares the draft with the displayed run for the TopBar pill.
 *
 * Drop anywhere (S9): dragging a file over the card shows an overlay ("Drop
 * your .ork to import it"); dropping it feeds `importer.pick` exactly like
 * the drop zone, so the destination card asks where it goes. A counter of
 * `dragenter`/`dragleave` keeps the overlay steady while the pointer
 * crosses child elements. A drop a nested drop zone already handled
 * (`defaultPrevented`) is not picked twice.
 *
 * The inputs/results row is `isolate`d so Leaflet's controls and attribution
 * (z-index 400–1000 inside the map) stay below the top bar's rocket panel.
 */

import { useEffect, useRef, useState, type DragEvent } from "react";
import { useT } from "@/components/i18n/LocaleProvider";
import { TopBar } from "./TopBar";
import { InputsPanel } from "./InputsPanel";
import { ResultsColumn } from "./ResultsColumn";
import { UploadIcon } from "./icons";
import { useOrkImport } from "./useOrkImport";
import { useRunSimulation } from "./useRunSimulation";
import { useWorkbenchUrl } from "./useWorkbenchUrl";

function carriesFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function WorkbenchShell() {
  const t = useT();
  const url = useWorkbenchUrl();
  const importer = useOrkImport();
  const simulation = useRunSimulation({ hold: importer.converting });
  const { run, ready } = simulation;
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);

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

  function onDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!carriesFiles(event)) return;
    dragDepth.current += 1;
    setDragging(true);
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    if (!carriesFiles(event)) return;
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragging(false);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    // Without this the browser opens the file instead of dropping it here.
    if (carriesFiles(event)) event.preventDefault();
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    dragDepth.current = 0;
    setDragging(false);
    if (event.defaultPrevented) return;
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file && !importer.converting) importer.pick(file);
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col p-3 lg:pl-0">
      <div
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
        className="relative flex flex-1 flex-col rounded-2xl border border-border bg-surface shadow-soft"
      >
        <TopBar simulation={simulation} importer={importer} url={url} />
        <div className="isolate flex flex-1 flex-col lg:flex-row">
          <InputsPanel errors={simulation.errors} />
          <ResultsColumn errors={simulation.errors} fatal={simulation.fatal} importer={importer} url={url} />
        </div>
        {dragging && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-2xl border-2 border-dashed border-accent bg-[var(--scrim)]"
          >
            <span className="flex items-center gap-2.5 rounded-xl bg-surface px-4 py-3 text-sm font-medium text-ink shadow-soft-lg">
              <UploadIcon className="text-accent-ink" />
              {t("workbench.dropAnywhere")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
