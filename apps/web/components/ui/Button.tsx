import type { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import Link from "next/link";
import { buttonClass, type ButtonSize, type ButtonVariant } from "./classes";

type Look = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Trailing arrow, for actions that move you forward (Sign in). */
  withArrow?: boolean;
};

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 7h8M7 3l4 4-4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Body({ withArrow, children }: { withArrow: boolean; children: ReactNode }) {
  return (
    <>
      {children}
      {withArrow && <ArrowIcon />}
    </>
  );
}

/** Button — the kit's action control (primary / ghost / chip; 36 px). */
export function Button({
  variant = "primary",
  size,
  withArrow = false,
  className,
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & Look) {
  return (
    <button type={type} className={buttonClass({ variant, size, className })} {...props}>
      <Body withArrow={withArrow}>{children}</Body>
    </button>
  );
}

/**
 * ButtonLink — the same look for navigation. Actions are buttons,
 * destinations are links: a real <a> keeps Cmd/Ctrl-click, middle-click and
 * "open in new tab" working, which `router.push` from a button cannot.
 */
export function ButtonLink({
  variant = "primary",
  size,
  withArrow = false,
  className,
  children,
  ...props
}: ComponentProps<typeof Link> & Look) {
  return (
    <Link className={buttonClass({ variant, size, className })} {...props}>
      <Body withArrow={withArrow}>{children}</Body>
    </Link>
  );
}
