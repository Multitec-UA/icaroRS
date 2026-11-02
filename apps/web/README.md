# icaro Web (Phase 2)

React/Next.js front-end for icaroRS. **Presentation only** — it consumes the
frozen **icaro API** (`apps/api`) over HTTP. The browser never reaches the
simulation code directly. Any new behaviour starts as a use-case in
`packages/icaro/`, is exposed by the API, and is finally rendered here.

> Not a `uv` workspace member. This is a standalone Node project (npm).

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4

> ⚠️ Next 16 renamed Middleware → **Proxy** and changed several conventions.
> Before editing config/routing, read the bundled docs in
> `node_modules/next/dist/docs/` — they describe *this* version, not older ones.

## How the SPA talks to the API

The API runs on a different origin (FastAPI, `:8000`). Rather than enabling CORS
on the API, the Next server **proxies** `/api/*` to the API origin via
`rewrites()` in `next.config.ts`. To the browser everything is same-origin
(`:3000`), so there is no CORS and the frozen `/api` contract is untouched.

Override the target with `ICARO_API_ORIGIN` (defaults to `http://127.0.0.1:8000`).

## Auth

The API protects every route with a GCP Identity Platform session cookie
(httpOnly — unreadable from JS). `components/auth/AuthGate.tsx` signs in with
the Firebase client SDK (`lib/firebase.ts`), exchanges the ID token for the
cookie via `POST /api/auth/session`, and confirms it via `GET /api/auth/me`
(the only way to check "am I signed in?", since the cookie itself can't be
read). A `401` from any request sends the user back to the login screen.

Client-side sign-in needs the Identity Platform project's public web config —
not a secret — as `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`,
`NEXT_PUBLIC_FIREBASE_PROJECT_ID` (Console → Project settings → General → Your
apps). These are inlined into the client bundle at **build** time, not read at
runtime — see `Dockerfile` for the production build args.

## Layout

```
lib/api.ts                       typed client for the /api contract + auth (types generated from openapi/schema.json)
lib/theme.ts, components/theme/  pastel light / soft dark themes (icaro-theme cookie, data-theme on <html>)
components/shell/                sidebar shared by every signed-in route (Workbench · Rockets · Runs)
components/workbench/            the Workbench at /: rocket context, .ork import states, inputs, results
components/flight/               flight replay, KPI cards, series panel, timeline, overlay chart
components/runs/, components/results/  /runs (compare runs of one rocket) and /results/[runId] (run report)
components/wizard/WizardProvider  the scenario draft store (export, rocket, site, time, rail, uncertainty, result)
app/                             App Router pages (/history redirects to /runs)
```

## Develop

```bash
# 1) start the API (from repo root) — see apps/api. Needs a real Identity
#    Platform project (Application Default Credentials resolve it) to verify
#    session cookies — see DEPLOY.md → Identity Platform (auth).
ICARO_ORK_JAR=packages/rocketserializer/OpenRocket-23.09.jar \
  uv run uvicorn icaro_api.main:app --port 8000

# 2) start the web app — needs NEXT_PUBLIC_FIREBASE_* in .env.local (see Auth above)
cd apps/web && npm run dev   # http://localhost:3000
```

### Without a real Identity Platform project (Auth emulator)

The whole stack also runs against the Firebase **Auth emulator**, so no GCP
project or credentials are needed. `lib/firebase.ts` connects to it when
`NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` is set; `firebase-admin` on the API
side honours `FIREBASE_AUTH_EMULATOR_HOST`. Every `demo-*` project id is
accepted by the emulator without a real project behind it.

```bash
# 1) Auth emulator (needs Java ≥ 21). Any directory with this firebase.json works:
#    { "emulators": { "auth": { "host": "127.0.0.1", "port": 9099 } } }
firebase emulators:start --only auth --project demo-icaro

# 2) API against the emulator (from repo root). Cookie `secure` off for plain HTTP.
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GOOGLE_CLOUD_PROJECT=demo-icaro \
  ICARO_SESSION_COOKIE_SECURE=false \
  ICARO_ORK_JAR=packages/rocketserializer/OpenRocket-23.09.jar \
  uv run uvicorn icaro_api.main:app --port 8000

# 3) Web — any API key works with the emulator; the project id must match.
cd apps/web && NEXT_PUBLIC_FIREBASE_API_KEY=demo-local-key \
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=demo-icaro.firebaseapp.com \
  NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-icaro \
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run dev
```

Users still need the `org_id` custom claim. Create one against the emulator
with `firebase-admin` (same env as the API):
`auth.create_user(email=..., password=...)` then
`auth.set_custom_user_claims(uid, {"org_id": "..."})`.

## Workbench URL

The Workbench keeps its state in the query string, so refresh, the back
button and shared links keep it (`components/workbench/useWorkbenchUrl.ts`):

| URL | Shows |
| --- | --- |
| `/` | nothing loaded (the drop zone), or the in-memory draft, written into the URL |
| `/?file={export_id}` | that file loaded, no run on screen |
| `/?run={run_id}` | that run's file, scenario and result, "Up to date · run {id}" |

Loading a file replaces the URL; a new run pushes it, so back returns to the
state before the run. A new file (uploaded or picked, of any rocket) starts
clean, as the first one does: the run on screen leaves it (it stays in
`/runs`), the site, launch time and weather stay, and rail overrides stay
only for a new file of the same rocket. Scenario edits never touch the URL. "Open in Workbench"
on `/runs` and on the report links to `/?run={id}`; "Use this rocket" links
to `/?file={newest export}`. A run or file the API no longer has (404) shows
"This run's file is no longer available" / "This file is no longer
available" with "Start fresh". A run still in flight when the user leaves the
Workbench keeps going and announces itself with a toast ("{rocket} · apogee
{value}" with an "Open" link).

Edits made after a run survive a refresh: the draft's scenario (site, launch
time, atmosphere, rail overrides) is saved synchronously on every change to
`sessionStorage` under `icaro:draft:{export_id}` (`lib/draft-storage.ts`),
with the run it started from. When `/?run={id}` resolves, a stored draft of
the same file and run replaces the run's own scenario, so the pill reads
"Changed since run {id}" again with the same chips. "Start fresh" clears
every stored draft.

Below 1024 px (`lg`) the layout is for phones and tablets: the sidebar
becomes a bottom bar (Workbench · Rockets · Runs · account, 44 px targets,
safe-area padded). With no file loaded the Workbench has no tabs: the
results column (drop zone and rocket picker) is the whole screen. Once a
file is loaded its two columns become two tabs, "Inputs" and "Result",
opening on Inputs; pressing Run (button or ⌘↵) switches to Result, and a
result arriving later never switches tabs. Switching tabs only hides the
other column, so nothing typed is lost. Below 768 px (`md`) the
status pill shrinks to its dot (full text in its tooltip and accessible
name). The run report is one column at any width, KPI cards 2×2 until their
container is 42rem wide.

## Visual regression

`e2e/` holds a Playwright suite that screenshots every screen (Workbench
empty / destination / converting / ready / with result, Rocket panel,
`/rockets`, `/runs` with the compare overlay, the run report, login) in both
themes at 1440×900, plus three phone shots at 390×844 in light
(`e2e/mobile.spec.ts`: the Workbench with no file (full-screen import), on
its Inputs tab, on its Result tab after Run, and the run report) and a desktop check that the phone bottom bar never
shows at 1440.
`e2e/flows.spec.ts` adds behaviour flows without screenshots: run and file
URLs, "Open in Workbench" from `/runs` and back, the 404 message, a `.ork`
dropped anywhere on the Workbench, leaving and coming back, and an edit
after a run surviving a reload.

```bash
npm run e2e:visual          # compare against the committed snapshots (Docker)
npm run e2e:visual:update   # regenerate every snapshot after an intended UI change
npm run e2e:visual:native   # host browser, for debugging only
```

> **Baseline:** the committed snapshots are Linux renders from the CI image.
> To re-baseline without Docker, let the `web-visual` job run (it uploads the
> fresh renders as the `web-visual-snapshots` artifact), download it with
> `gh run download <run-id> -n web-visual-snapshots -D apps/web/e2e/__screenshots__`
> and commit the PNGs you reviewed. `npm run e2e:visual:native` renders on the
> host and will differ from the committed pixels; use it for debugging only.

- **What runs:** `playwright.config.ts` boots `e2e/stub-api.mjs` (a
  deterministic stub of the icaro API on `:4010`: one org, two rockets, three
  files, four runs) and a production build on `:4011` built with
  `ICARO_API_ORIGIN` pointing at the stub. Tests freeze the clock, pin the
  time zone and locale, reduce motion, serve a flat map tile and mask only the
  WebGL flight replay. The cookie `e2e-anon=1` makes the stub answer 401 on
  `/api/auth/me` (login screen).
- **Snapshots:** `e2e/__screenshots__/<spec file>/<name>.png`. Review the
  diff images in `playwright-report/` when a run fails.
- **Why Docker:** font rasterisation differs between macOS, Linux and CPU
  architectures, so snapshots are only generated inside
  `mcr.microsoft.com/playwright:v1.64.1-noble` (linux/amd64, the same image
  as the `web-visual` CI job). `e2e/run-in-docker.sh` keeps `node_modules`
  and `.next` in Docker volumes and re-runs `npm ci` only when
  `package-lock.json` changes. On Apple Silicon the image runs under
  emulation, so the first run is slow. Native runs will not match the
  committed pixels.
