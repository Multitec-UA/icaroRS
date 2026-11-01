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
 * Phones and tablets (< lg, S10/S12j): with no file loaded there are no
 * tabs: the results column (drop zone and rocket picker) is the whole
 * screen and the inputs column is hidden. Once a file is loaded two tabs
 * appear, "Inputs" and "Result", opening on Inputs. Pressing Run (the
 * button or ⌘↵) switches to Result in the Run handler; a result arriving
 * later never switches tabs. The inactive column is only hidden by CSS
 * (`max-lg:hidden`), never unmounted, so typed values, the map and the
 * replay keep their state; each tab remembers its own page scroll. At lg
 * and up the tab row is hidden and both columns show side by side.
 *
 * The inputs/results row is `isolate`d so Leaflet's controls and attribution
 * (z-index 400–1000 inside the map) stay below the top bar's rocket panel.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useWizardDraft } from "@/components/wizard/WizardProvider";
import { cn, focusRing } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";
import { TopBar } from "./TopBar";
import { InputsPanel } from "./InputsPanel";
import { ResultsColumn } from "./ResultsColumn";
import { UploadIcon } from "./icons";
import { useOrkImport } from "./useOrkImport";
import { useRunSimulation } from "./useRunSimulation";
import { useWorkbenchUrl } from "./useWorkbenchUrl";

type Tab = "inputs" | "result";
const TABS: readonly Tab[] = ["inputs", "result"];

/**
 * The phone tab state (S12j): Inputs whenever a file gets loaded; Result
 * only when the user picks it or presses Run (`select`). Page scroll is
 * kept per tab. Without a file the tabs are not rendered at all.
 */
function useWorkbenchTab(hasFile: boolean) {
  const [tab, setTab] = useState<Tab>("inputs");
  const [shownFile, setShownFile] = useState(hasFile);
  const scroll = useRef<Record<Tab, number>>({ inputs: 0, result: 0 });
  const restore = useRef<number | null>(null);

  // Adjusting state during render (not in an effect): a freshly loaded file
  // opens on Inputs.
  if (hasFile !== shownFile) {
    setShownFile(hasFile);
    if (hasFile) setTab("inputs");
  }

  const select = useCallback(
    (next: Tab) => {
      if (next === tab) return;
      scroll.current[tab] = window.scrollY;
      restore.current = scroll.current[next];
      setTab(next);
    },
    [tab],
  );

  useLayoutEffect(() => {
    if (restore.current === null) return;
    window.scrollTo({ top: restore.current });
    restore.current = null;
  }, [tab]);

  return { tab, select };
}

function carriesFiles(event: DragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

export function WorkbenchShell() {
  const t = useT();
  const url = useWorkbenchUrl();
  const importer = useOrkImport();
  const simulation = useRunSimulation({ hold: importer.converting });
  const { state } = useWizardDraft();
  const hasFile = state.exportId !== null;
  const { tab, select } = useWorkbenchTab(hasFile);
  const { run: send, ready } = simulation;
  // Pressing Run shows the Result tab at once (S12j); the result itself
  // never moves the tabs.
  const run = useCallback(async () => {
    if (!ready) return;
    select("result");
    await send();
  }, [ready, select, send]);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ inputs: null, result: null });
  const ids = useId();
  const panelId = (name: Tab) => `${ids}-${name}`;
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

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    const index = TABS.indexOf(tab);
    const next =
      event.key === "ArrowRight"
        ? TABS[(index + 1) % TABS.length]
        : event.key === "ArrowLeft"
          ? TABS[(index - 1 + TABS.length) % TABS.length]
          : event.key === "Home"
            ? TABS[0]
            : event.key === "End"
              ? TABS[TABS.length - 1]
              : null;
    if (!next) return;
    event.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  }

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
        <TopBar simulation={{ ...simulation, run }} importer={importer} url={url} />
        {hasFile && (
          <div
            role="tablist"
            aria-label={t("workbench.viewTabs")}
            className="sticky top-0 z-10 grid grid-cols-2 gap-1 border-b border-divider bg-surface px-3 py-2 lg:hidden"
          >
            {TABS.map((name) => {
              const selected = tab === name;
              return (
                <button
                  key={name}
                  ref={(node) => {
                    tabRefs.current[name] = node;
                  }}
                  type="button"
                  role="tab"
                  id={`${panelId(name)}-tab`}
                  aria-selected={selected}
                  aria-controls={panelId(name)}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => select(name)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    "min-h-11 rounded-[9px] text-sm font-semibold transition-[background-color,color,box-shadow] duration-300 ease-[var(--ease-spring)]",
                    focusRing,
                    selected
                      ? "bg-surface text-ink shadow-soft ring-1 ring-border"
                      : "bg-surface-2 text-muted hover:text-ink",
                  )}
                >
                  {name === "inputs" ? t("workbench.tabInputs") : t("workbench.tabResult")}
                </button>
              );
            })}
          </div>
        )}
        <div className="isolate flex flex-1 flex-col lg:flex-row">
          <InputsPanel id={panelId("inputs")} hidden={!hasFile || tab !== "inputs"} errors={simulation.errors} />
          <ResultsColumn
            id={panelId("result")}
            hidden={hasFile && tab !== "result"}
            errors={simulation.errors}
            fatal={simulation.fatal}
            importer={importer}
            url={url}
          />
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
