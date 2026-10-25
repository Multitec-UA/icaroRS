/**
 * Line icons for the Workbench chrome (16px grid, 2px strokes — the same
 * glyphs the approved canvas uses). All decorative: callers put the text
 * next to them, so every icon is `aria-hidden`.
 */

import type { SVGProps } from "react";

/** Public icon props: the glyph owns its own children. */
type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
      {...props}
    />
  );
}

export function RocketIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 2c3 3 4 7 4 11l-4 3-4-3c0-4 1-8 4-11z" />
      <path d="M9 18l-2 4M15 18l2 4" />
    </Icon>
  );
}

export function WorkbenchIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="18" rx="2" />
      <rect x="14" y="3" width="7" height="18" rx="2" />
    </Icon>
  );
}

export function RunsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 12h4l3-8 4 16 3-8h4" />
    </Icon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <Icon {...props} fill="currentColor" stroke="none" width="14" height="14">
      <path d="M7 4l13 8-13 8z" />
    </Icon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props} width="14" height="14">
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function UploadIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16v.5" />
    </Icon>
  );
}
