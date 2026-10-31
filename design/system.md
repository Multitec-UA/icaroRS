# icaro design system (synced from source)

Synced 2026-10-31 from `apps/web/app/globals.css`, `apps/web/components/workbench/styles.ts`, `apps/web/app/layout.tsx`. Values below are the ones found in those sources; nothing invented.

## Principles (from the source comments)

- Two soft palettes, one token set: light is pastel (lavender-tinted greys, periwinkle accent), dark is soft indigo-grey. No pure `#000` / `#fff` anywhere. (`globals.css:3-9`)
- Components style against tokens (`bg-surface`, `text-ink`, `border-divider`…), never literal colours. (`globals.css:8-10`)
- Theme: `data-theme="light|dark"` on `<html>` wins; otherwise `prefers-color-scheme`. (`globals.css:12-15`)
- Spring easing is the only curve: `--ease-spring: cubic-bezier(0.32,0.72,0,1)`, `--ease-out-soft: cubic-bezier(0.16,1,0.3,1)`. (`globals.css:174-176`)
- Tabular numerals on the whole body; `.tabular-readout` = Geist Mono, tabular, `-0.02em`. (`globals.css:191-192, 204-208`)
- Reduced motion: orbs stop, all animations/transitions collapse to 0.01 ms. (`globals.css:225-231`)

## Colors (`globals.css`)

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--bg` | `#f3f1f8` | `#1e1d2a` | page background |
| `--surface` | `#fbfafd` | `#262535` | cards, panels, inputs |
| `--surface-2` | `#f0edf6` | `#2e2d3f` | hover, secondary surfaces |
| `--border` | `#e2ddec` | `#3a384d` | control borders |
| `--divider` | `#ebe7f2` | `#33324a` | hairlines between sections |
| `--ink` | `#2b2840` | `#e6e3f2` | primary text |
| `--ink-2` | `#4a4662` | `#c4c0d8` | secondary text |
| `--muted` | `#6e6987` | `#9a96b2` | labels, help text |
| `--axis` | `#c9c3da` | `#4b4961` | chart axes, gridlines |
| `--accent` | `#6b7fe0` | `#8e9cf2` | accent fills, sparklines |
| `--accent-ink` | `#4757b8` | `#aeb8f7` | accent text, links |
| `--accent-soft` | `#e3e7fb` | `#34385c` | accent backgrounds, selected rows |
| `--primary` | `#5160cc` | `#8e9cf2` | primary button fill |
| `--on-primary` | `#fbfafd` | `#1e1d2a` | text on primary |
| `--chip` | `#ece8f4` | `#34324a` | chips, kbd |
| `--ok` / `--ok-soft` / `--ok-ink` | `#5fb38d` / `#dff3ea` / `#2d6a50` | `#6fc79f` / `#27402f` / `#a9e3c6` | success pill |
| `--warn` / `--warn-soft` / `--warn-ink` | `#e3a857` / `#fcefd9` / `#7a5420` | `#e8b86a` / `#4a3a22` / `#f2d39a` | warnings, stale |
| `--bad` / `--bad-soft` / `--bad-ink` | `#e07b86` / `#fbe3e6` / `#9e3a47` | `#e8909a` / `#4a2a30` / `#f3b6bd` | errors |
| `--peach` | `#ee9a72` | `#f2ae8b` | secondary series colour |
| `--scrim` | `rgba(43,40,64,.28)` | `rgba(14,13,22,.55)` | modal backdrop |
| `--orb-a` / `--orb-b` | `rgba(107,127,224,.18)` / `rgba(238,154,114,.14)` | `rgba(142,156,242,.16)` / `rgba(242,174,139,.1)` | ambient background orbs |

Tailwind exposes every token as `--color-*` through `@theme inline`. The legacy aliases (`--background`, `--foreground`, `--accent-cyan`, `--accent-violet`) are removed. `.palette-light` pins a subtree to the light palette in either theme (plot frames, S7).

### Contrast checks

WCAG 2 relative-luminance ratios, measured 2026-10-31 (AA for 14 px text needs 4.5:1). Only the light `--primary` failed and was darkened from `#5b6cd6` (4.43:1) to `#5160cc`.

| Text on background | Light | Dark |
| --- | --- | --- |
| `--on-primary` on `--primary` | 5.18:1 | 6.48:1 |
| `--accent-ink` on `--accent-soft` | 5.14:1 | 5.89:1 |
| `--ok-ink` on `--ok-soft` | 5.52:1 | 7.79:1 |
| `--warn-ink` on `--warn-soft` | 5.93:1 | 7.59:1 |
| `--bad-ink` on `--bad-soft` | 5.47:1 | 7.35:1 |
| `--muted` on `--surface` | 5.01:1 | 5.28:1 |
| `--ink-2` on `--chip` | 7.43:1 | 6.98:1 |

## Typography (`layout.tsx:15-22`, `globals.css`)

- Sans: Geist (`--font-geist-sans`), fallback `system-ui, sans-serif`. Body antialiased, tabular numerals.
- Mono: Geist Mono (`--font-geist-mono`), used for readouts, kbd and file names.
- Sizes in use (Tailwind classes in `styles.ts`, `TopBar.tsx`): 11px (kbd), 13px (chips, links, converting filename), 14px (`text-sm`, controls), plus Tailwind defaults for headings. No type scale is declared as tokens.

## Spacing, radius, shadows

- Controls: height 36px (`h-9`), padding 12–14px, radius 9px (`rounded-[9px]`) for buttons; chips are 32px (`h-8`) full-round; links `rounded-md`. (`components/ui/classes.ts`)
- Cards: radius 14px, 1px `--border`, `--shadow` (`cardClass`). Popovers/menus: radius 12px, `--shadow-lg` (`popoverClass`).
- Under `pointer: coarse` every button, input and segment grows to a 44px hit area (`pointer-coarse:min-h-11`).
- Shadows: `--shadow` (1px/24px soft), `--shadow-lg` (40–48px); Tailwind `shadow-soft`, `shadow-soft-lg`. (`globals.css:38-39, 168-169`)
- `scroll-padding-top: 5rem` for the sticky nav; `touch-action: manipulation`; no overscroll bounce on fine pointers. (`globals.css:162-186`)

## Control kit (`apps/web/components/ui/`, S2)

One token-based kit; `components/ui.tsx` re-exports it and `components/workbench/styles.ts` re-exports its class builders.

- `Button` / `ButtonLink`: variants `primary` (filled `--primary`), `ghost` (bordered `--surface`), `chip` (full-round `--chip`, 32px, hover `--accent-soft`), `danger` (`--bad-soft` / `--bad-ink`); sizes `md` 36px, `sm` 32px; radius 9px; optional trailing arrow. `type="button"` by default. Class builder: `buttonClass({ variant, size, className })`, plus `primaryButton`, `ghostButton`, `chipButton`, `textLink`.
- `StatusPill`: tones `ok` / `warn` / `bad` / `neutral` (soft fill + ink), 28px full-round, 7px dot (default) or decorative spinner; a polite `role="status"`.
- `Field` + `TextInput` + `Select`: 36px, radius 9px, `--border` on `--surface`, accent border + ring on focus, `--bad` border when invalid; the field wires hint/error to the control.
- `Card` (`cardClass`), `Disclosure` (native `<details>` card, chevron, title + `(count)` + meta slot; Enter/Space toggle; `onToggle(open)`), `Kbd` (chip, or outlined on a primary button), `Spinner`, `Callout` (info/warning/error/success), `SegmentedControl`.
- Tone map `toneClass` is shared by pills, callouts and banners.

## Component rules (`components/ui/classes.ts`, re-exported by `components/workbench/styles.ts`)

- `primaryButton`: filled `bg-primary text-on-primary`, hover lifts with `shadow-soft`, active `scale-[0.98]`, disabled 50% opacity, 300 ms spring transition, focus ring from `lib/styles`.
- `ghostButton`: `border-border bg-surface text-ink`, hover `bg-surface-2`.
- `chipButton`: `bg-chip text-ink-2`, hover `bg-accent-soft text-accent-ink`.
- `textLink`: `text-accent-ink`, hover `text-ink`.
- Status pills: `StatusPill` from the kit. KPI cards and section headers are still composed inline in the Workbench.
