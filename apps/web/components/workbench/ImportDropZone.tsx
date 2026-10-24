"use client";

/**
 * ImportDropZone — a dashed target for one `.ork` file (S8). The zone IS the
 * file input's label: clicking or activating it opens the native picker, and
 * the sr-only input stays in the tab order, so keyboard users get the same
 * path as mouse users. Validation of the file happens in the caller
 * (useOrkImport), which also decides where the file goes.
 */

import { useId, useState, type DragEvent, type ReactNode } from "react";
import { cn } from "@/lib/styles";
import { UploadIcon } from "./icons";

export function ImportDropZone({
  title,
  hint,
  note,
  inputLabel,
  inputName,
  onFile,
  compact = false,
}: {
  title: string;
  hint?: ReactNode;
  note?: string;
  /** Accessible name of the hidden file input. */
  inputLabel: string;
  inputName: string;
  onFile: (file: File) => void;
  /** Row layout for inside the rocket panel; the default is the tall A1 target. */
  compact?: boolean;
}) {
  const inputId = useId();
  const [dragging, setDragging] = useState(false);

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <label
      htmlFor={inputId}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={cn(
        "flex cursor-pointer rounded-2xl border border-dashed transition-[border-color,background-color,box-shadow] duration-300 ease-[var(--ease-spring)]",
        "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/60 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-bg",
        compact
          ? "items-center gap-3 px-4 py-3 text-left"
          : "flex-col items-center justify-center gap-2 px-6 py-10 text-center",
        dragging ? "border-accent bg-accent-soft shadow-soft" : "border-axis bg-surface-2 hover:border-accent hover:bg-surface",
      )}
    >
      <input
        id={inputId}
        name={inputName}
        type="file"
        accept=".ork"
        className="sr-only"
        aria-label={inputLabel}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Clear the control so choosing the same file again fires onChange.
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent-ink",
          compact ? "h-9 w-9" : "mb-1 h-12 w-12",
        )}
      >
        <UploadIcon width={compact ? 16 : 20} height={compact ? 16 : 20} />
      </span>
      <span className={cn("flex min-w-0 flex-col", compact ? "gap-0.5" : "items-center gap-1")}>
        <span className="text-sm font-medium text-ink">{title}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      {note && <span className="mt-2 max-w-md text-balance text-xs text-ink-2">{note}</span>}
    </label>
  );
}
