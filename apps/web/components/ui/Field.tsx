"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { cn } from "@/lib/styles";
import { InfoTip } from "@/components/InfoTip";
import { inputClass, selectControlClass } from "./classes";

/**
 * Field — label + control slot + inline hint or error. The hint and the error
 * get stable ids and are wired to the control (`aria-describedby` /
 * `aria-invalid`) so assistive tech reads them with the field; the error is
 * an alert so it is announced when validation inserts it.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  term,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  term?: string;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  // Wire the first element child (the control) without asking every caller to
  // repeat the ids; later siblings (adornments, buttons) are left alone.
  // Explicit props on the child win, so a caller can still override.
  const items = Children.toArray(children);
  const controlIndex = items.findIndex((child) => isValidElement(child));
  const control = items.map((child, index) =>
    index === controlIndex && isValidElement<Record<string, unknown>>(child)
      ? cloneElement(child, {
          "aria-invalid": child.props["aria-invalid"] ?? (error ? true : undefined),
          "aria-describedby": child.props["aria-describedby"] ?? describedBy,
        })
      : child,
  );

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="flex items-center gap-1.5 text-[13px] font-medium text-ink-2">
        {label}
        {term && <InfoTip term={term} />}
      </label>
      {control}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs font-medium text-bad-ink">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(selectControlClass, className)} {...props} />;
}
