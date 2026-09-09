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
lib/api.ts                       typed client for the frozen /api contract + auth
components/wizard/WizardProvider  state machine: rocket → basics → advanced → review → results
app/                             App Router pages
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
