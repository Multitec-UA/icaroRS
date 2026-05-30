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

The API protects every route with HTTP Basic. The SPA holds credentials in
`sessionStorage` (set from a login screen) and `lib/api.ts` attaches an
`Authorization: Basic` header to every request. A `401` clears the stored
credentials and sends the user back to the login screen.

## Layout

```
lib/api.ts                       typed client for the frozen /api contract + auth
components/wizard/WizardProvider  state machine: rocket → basics → advanced → review → results
app/                             App Router pages
```

## Develop

```bash
# 1) start the API (from repo root) — see apps/api
ICARO_BASIC_USER=icaro ICARO_BASIC_PASS=icaro \
  ICARO_ORK_JAR=packages/rocketserializer/OpenRocket-23.09.jar \
  uv run uvicorn icaro_api.main:app --port 8000

# 2) start the web app
cd apps/web && npm run dev   # http://localhost:3000
```
