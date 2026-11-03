# icaro design system (synced from source)

Synced 2026-11-03 (Multitec brand, `design/multitec-brand/01-identity-graphite.html`) from `apps/web/app/globals.css`, `apps/web/components/workbench/styles.ts`, `apps/web/app/layout.tsx`. Values below are the ones found in those sources; nothing invented.

## Principles (from the source comments)

- Multitec identity: warm greys, graphite actions, and the Multitec red `#AE2418` only where it identifies (logo, active nav, chart series 1); the lighter `#e96d62` carries it on dark surfaces. Red never marks focus, selection or an action, so it reads only as brand or (raspberry) error. Deltas are neutral. No pure `#000` / `#fff`. (`globals.css:3-12`)
- Components style against tokens (`bg-surface`, `text-ink`, `border-divider`…), never literal colours. (`globals.css:8-10`)
- Theme: `data-theme="light|dark"` on `<html>` wins; otherwise `prefers-color-scheme`. (`globals.css:12-15`)
- Spring easing is the only curve: `--ease-spring: cubic-bezier(0.32,0.72,0,1)`, `--ease-out-soft: cubic-bezier(0.16,1,0.3,1)`. (`globals.css:174-176`)
- Tabular numerals on the whole body; `.tabular-readout` = Geist Mono, tabular, `-0.02em`. (`globals.css:191-192, 204-208`)
- Reduced motion: orbs stop, all animations/transitions collapse to 0.01 ms. (`globals.css:225-231`)

## Colors (`globals.css`)

| Token | Light | Dark | Usage |
| --- | --- | --- | --- |
| `--bg` | `#f5f3f2` | `#1c1a19` | page background |
| `--surface` | `#fcfbfa` | `#252221` | cards, panels, inputs |
| `--surface-2` | `#f1eeec` | `#2e2a29` | hover, secondary surfaces, active nav item |
| `--border` | `#e3dedb` | `#3b3634` | control borders |
| `--divider` | `#ece8e5` | `#332f2d` | hairlines between sections |
| `--ink` | `#24201f` | `#ece7e4` | primary text, focus ring |
| `--ink-2` | `#4a4442` | `#c9c2be` | secondary text, focused/selected borders |
| `--muted` | `#6c6562` | `#a39b97` | labels, help text, neutral deltas |
| `--axis` | `#cdc6c2` | `#4d4744` | chart axes, gridlines, dashed outlines (decorative) |
| `--accent` | `#ae2418` | `#e96d62` | Multitec red for identity and data only: active-nav bar, chart series 1, rocket dot, map marker, import progress. Never focus, selection or actions |
| `--accent-ink` | `#4a4442` | `#c9c2be` | links and text on selection (graphite) |
| `--accent-soft` | `#f1eeec` | `#2e2a29` | selection and hover backgrounds (graphite) |
| `--primary` | `#2a2625` | `#e6e1de` | primary button fill, selected chips/tabs, radios and checkboxes (graphite) |
| `--on-primary` | `#fcfbfa` | `#1c1a19` | text on primary |
| `--brand` | `#ae2418` | `#ae2418` | the Multitec mark: logo square, favicon, PDF header rule (same red in both themes) |
| `--on-brand` | `#fcfbfa` | `#fcfbfa` | glyph on the brand mark |
| `--chip` | `#ece7e3` | `#36312f` | chips, kbd |
| `--ok` / `--ok-soft` / `--ok-ink` | `#5fb38d` / `#dff3ea` / `#2d6a50` | `#6fc79f` / `#27402f` / `#a9e3c6` | success pill |
| `--warn` / `--warn-soft` / `--warn-ink` | `#e3a857` / `#fcefd9` / `#7a5420` | `#e8b86a` / `#4a3a22` / `#f2d39a` | warnings, stale |
| `--bad` / `--bad-soft` / `--bad-ink` | `#d9497a` / `#fbe4ec` / `#a3264f` | `#f0789f` / `#4a2433` / `#f7b3c9` | errors: a raspberry distinct from the brand red, always with an icon and text |
| `--peach` | `#6c6562` | `#a39b97` | chart series 2 (graphite next to the red series 1); the name is historical |
| `--scrim` | `rgba(36, 32, 31, 0.28)` | `rgba(12, 11, 10, 0.55)` | modal backdrop |
| `--orb-a` / `--orb-b` | `rgba(174, 36, 24, 0.05)` / `rgba(111, 104, 101, 0.06)` | `rgba(233, 109, 98, 0.06)` / `rgba(163, 155, 151, 0.05)` | ambient background orbs |

Tailwind exposes every token as `--color-*` through `@theme inline`. The legacy aliases (`--background`, `--foreground`, `--accent-cyan`, `--accent-violet`) are removed. `.palette-light` pins a subtree to the light palette in either theme (plot frames, S7).

### Contrast checks

WCAG 2 relative-luminance ratios, measured 2026-11-03 (AA for 14 px text needs 4.5:1; non-text 3:1). `--muted` was darkened from `#6f6865` to `#6c6562` so it passes on `--chip` (4.45 → 4.65:1).

| Text on background | Light | Dark |
| --- | --- | --- |
| `--on-primary` on `--primary` | 14.49:1 | 13.37:1 |
| `--accent-ink` on `--accent-soft` | 8.28:1 | 8.07:1 |
| `--ok-ink` on `--ok-soft` | 5.52:1 | 7.79:1 |
| `--warn-ink` on `--warn-soft` | 5.93:1 | 7.59:1 |
| `--bad-ink` on `--bad-soft` | 5.91:1 | 7.70:1 |
| `--muted` on `--surface` | 5.53:1 | 5.79:1 |
| `--muted` on `--surface-2` | 4.95:1 | 5.20:1 |
| `--muted` on `--chip` | 4.65:1 | 4.70:1 |
| `--ink-2` on `--chip` | 7.79:1 | 7.30:1 |
| `--on-brand` on `--brand` | 6.63:1 | 6.63:1 |
| [non-text] `--accent` on `--surface` | 6.63:1 | 5.14:1 |

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
- `Field` + `TextInput` + `Select`: 36px, radius 9px, `--border` on `--surface`, graphite (`--ink-2`) border + ink ring on focus, `--bad` border when invalid; the field wires hint/error to the control.
- `Card` (`cardClass`), `Disclosure` (native `<details>` card, chevron, title + `(count)` + meta slot; Enter/Space toggle; `onToggle(open)`), `Kbd` (chip, or outlined on a primary button), `Spinner`, `Callout` (info/warning/error/success), `SegmentedControl`.
- Tone map `toneClass` is shared by pills, callouts and banners.

## Component rules (`components/ui/classes.ts`, re-exported by `components/workbench/styles.ts`)

- `primaryButton`: filled `bg-primary text-on-primary`, hover lifts with `shadow-soft`, active `scale-[0.98]`, disabled 50% opacity, 300 ms spring transition, focus ring from `lib/styles`.
- `ghostButton`: `border-border bg-surface text-ink`, hover `bg-surface-2`.
- `chipButton`: `bg-chip text-ink-2`, hover `bg-accent-soft text-accent-ink` (graphite).
- `textLink`: `text-accent-ink`, hover `text-ink`.
- Status pills: `StatusPill` from the kit. KPI cards and section headers are still composed inline in the Workbench.
