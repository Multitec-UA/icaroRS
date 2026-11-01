<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# icaro web — orientation

- **Product model**: a *rocket* (a team's design, groups files) has *exports* (one converted `.ork` each, called "file" in the UI); a *scenario* (site, date, atmosphere, rail) is edited in the Workbench and has no identity of its own; a *run* is one simulation of one file under one scenario (`/runs` logbook, `/results/[runId]` report). Never call these "vehicle" or "version".
- **Workbench** (`/`, `components/workbench/`): the main screen. The rocket context button (top bar) is the active file; `.ork` import states, inputs and results live here. Its state is in the URL: `/?file={export_id}` while editing (`router.replace`), `/?run={run_id}` once a run is shown (`router.push`); `useWorkbenchUrl.ts` resolves it on mount. The status pill compares the canonical scenario (`lib/domain/scenario.ts`) with the run on screen (`displayedRun` in `WizardProvider`).
- **Results** (`components/results/RunResults.tsx`): the one composition the Workbench and the report both render (warnings, replay, KPIs, OpenRocket row, series, timeline, "All results", "Plots").
- **UI kit** (`components/ui/`): the only controls (Button, StatusPill, Field, Select, Card, Disclosure, Kbd, Toast…); `components/ui.tsx` re-exports it.
- **Visual net** (`e2e/`, Playwright): `npm run e2e:visual:native` compares every screen in both themes against `e2e/__screenshots__/` using the stub API in `e2e/stub-api.mjs`; `e2e/flows.spec.ts` holds behaviour flows. Re-baseline only shots you looked at. See README "Visual regression".
- **Themes** (`lib/theme.ts`, `components/theme/`): pastel light / soft dark palettes as tokens in `app/globals.css`; style with `bg-surface`, `text-ink`, `border-divider`, … — never literal colours or `bg-white/…`.
- **Flight view** (`components/flight/`): replay, KPI cards, series panel, timeline; reused by the run report (`/results/[runId]`) and `/runs`.
- **i18n**: every visible string goes through `useT()` with keys in `messages/en.json` and `messages/es.json`; edit the catalogs textually, then `npm run i18n:types` and `npm run i18n:check`.
- **API types** are generated from the committed `openapi/schema.json` (`npm run api:schema` then `npm run api:types`; CI runs `npm run api:check`).
