# imperial-units — Unit system switch (metric / imperial) across the web

Objective: one switch, persisted like theme and locale, that shows every visible measurement in imperial units (ft, ft/s, mph for wind, lb, in) and converts user inputs back to SI before they reach the API; the API and the domain stay metric.
Branch `feat/imperial-units` (from `main` d529c6f). Delivery: `ask-on-risk`. Runners: web `cd apps/web && npm test` + `npx tsc --noEmit` + `npm run lint` + `npm run i18n:check` + `npm run api:check` + `npm run build`; visual `npm run e2e:visual`.
Forecast: ~900 authored changed lines (T1 ~250 core, T2 ~400 outputs, T3 ~250 inputs/launch-day).

## Specs

- S1 Request (user, 2026-11-07): "ponme un botón para poder cambiar todas las medidas a sistema imperial". Decision (user): "pies y ft/s y viento en mph, respetemos el reglamento" (the L1 guide states landing speed limits in ft/s, 35 ft/s ≈ 10.7 m/s).
- S2 Unit system: `metric` (default, today's behaviour byte-identical) | `imperial`. Mapping, imperial side: length/altitude/distance m → ft (1 m = 3.28084 ft), long distance km → mi, speed m/s → ft/s, **wind speed km/h → mph**, mass kg → lb (1 kg = 2.20462 lb), diameter mm → in, acceleration m/s² → ft/s², impulse N·s stays N·s, angles °, time s, stability margin cal, Mach, % unchanged. Formatting keeps the project's locale-aware number formatting and the same precision rules as today (same significant digits, not more).
- S3 Persistence and switch: a `UnitsProvider` + `useUnits()` next to `ThemeProvider`, preference stored in a cookie read by the root layout (same mechanism as theme/locale, so SSR and client agree and there is no flash); a `UnitsToggle` in the `AccountMenu` next to `ThemeToggle` / `LanguageSwitch`, label "Units: metric / imperial" (es: "Unidades: métrico / imperial"); default `metric` when no cookie.
- S4 Outputs: every displayed measurement goes through one helper (`lib/units.ts`: `formatLength`, `formatSpeed`, `formatWindSpeed`, `formatMass`, `formatDiameter`, `formatAcceleration`, `unitLabel(kind)`), including: KPI cards and `SCALAR_SPECS` (`lib/scalars.ts`), series chart axes/tooltips, flight replay readouts, `RunResults`, `PrintableReport`, runs table deltas (`lib/domain/runs.ts`), rocket summary (mass, diameter, rail length), Monte Carlo card/report (apogee stats, histogram axis, landing distance, context/reading sentences), launch-day card (candidates table, checklist values and limits, wind used line). No visible measurement may remain hard-coded in metric when imperial is selected.
- S5 Inputs: wind speed (km/h ↔ mph), site elevation (m ↔ ft), rail length (m ↔ ft) show and accept the selected unit and convert to SI in the scenario body; the stored draft stays in SI so switching units never changes the simulation. Inclination/heading in degrees are unchanged.
- S6 Limits: L1 checklist limits are shown in the selected unit (e.g. descent ≤ 10 m/s → ≤ 32.8 ft/s; landing < 500 m → < 1640 ft; wind ≤ 32 km/h → ≤ 20 mph) while the comparison stays on the SI values the API returns.
- S7 Tests: unit tests for every converter (round-trip, 0, precision) and for the cookie resolution; a component test per surface proving the imperial rendering and that metric is unchanged (existing snapshots/tests untouched); inputs tests proving the SI body is identical whichever unit was typed in; i18n en/es.

## Tasks

- [ ] T1 — S2, S3, S7 — route: inline — `lib/units.ts`, `UnitsProvider`, `UnitsToggle`, cookie in root layout, i18n.
- [ ] T2 — S4, S7 — route: delegated writer (parallel with T3, disjoint surfaces) — outputs: scalars/KPI, charts, replay, results, report, runs deltas, rocket summary, Monte Carlo.
- [ ] T3 — S5, S6, S7 — route: delegated writer (parallel with T2) — inputs (wind, elevation, rail) and launch-day card/checklist.

## Log

- L1 (2026-11-07, user): "Claudio, hazme un favor, ponme un botón para poder cambiar todas las medidas a sistema imperial."
- L2 (2026-11-07, user): "pies y ft/s y viento en mph, respetemos el reglamento"
- L3 (2026-11-07): exploration: `lib/scalars.ts` centralises KPI units, but 82 hard-coded unit literals live across 14 files (charts, flight, results, workbench, lib/domain/*); theme/locale persist via cookie read by the root layout — the units preference follows the same pattern.
