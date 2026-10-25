<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# icaro web — orientation

- **Workbench** (`/`, `components/workbench/`): the main screen. The rocket context button (top bar) is the active *export* (one converted `.ork`) of a *rocket* (the group a team uploads files into); `.ork` import states, inputs and results live here. Never call these "vehicle" or "version".
- **Themes** (`lib/theme.ts`, `components/theme/`): pastel light / soft dark palettes as tokens in `app/globals.css`; style with `bg-surface`, `text-ink`, `border-divider`, … — never literal colours or `bg-white/…`.
- **Flight view** (`components/flight/`): replay, KPI cards, series panel, timeline; reused by the run report (`/results/[runId]`) and `/runs`.
- **i18n**: every visible string goes through `useT()` with keys in `messages/en.json` and `messages/es.json`; edit the catalogs textually, then `npm run i18n:types` and `npm run i18n:check`.
- **API types** are generated from the committed `openapi/schema.json` (`npm run api:schema` then `npm run api:types`; CI runs `npm run api:check`).
