# Deploying icaro to Cloud Run

This is the hand-off doc for infra. It tells you **what to deploy, with which
settings, and why** — so you own the `gcloud`/Terraform without needing the app
internals. The repo ships the two Dockerfiles; this doc is the runbook.

> **Scope.** Goal is to expose the app at `icaro.multitecua.com` for the team.
> **Persistence is now available** — saved rockets, simulation history, and
> re-launch — backed by GCS + Firestore. See
> [Persistence (GCS + Firestore)](#persistence-gcs--firestore). It is **opt-in**:
> if the persistence env vars are NOT set, run data stays **ephemeral** and is
> lost on any restart/redeploy (the original MVP behavior, still the default).
> Auth is Identity Platform-backed, multi-org — see
> [Identity Platform (auth)](#identity-platform-auth).

---

## Architecture — two services

```
                    icaro.multitecua.com
                            │  (HTTPS, public)
                            ▼
                   ┌──────────────────┐        proxies /api/* (server-side)
   browser ───────▶│   web  (Next 16) │ ───────────────────────────────┐
   (Identity        └──────────────────┘                                 │
    Platform          stateless, scales freely                           ▼
    session cookie)                                          ┌──────────────────────┐
                                                             │   api  (FastAPI)      │
                                                             │   JDK 21 + OpenRocket │
                                                             │   max-instances = 1   │
                                                             └──────────────────────┘
                                                               stateful on /tmp (tmpfs)
```

- **web** is the public face. It serves the SPA and **proxies `/api/*`** to the
  API at `ICARO_API_ORIGIN` (server-side rewrite — to the browser everything is
  same-origin, so no CORS). The incoming httpOnly session cookie is forwarded
  to the API like any other header, so app-level auth works through the proxy.
- **api** does the simulation. It is **not horizontally scalable in this MVP**
  (see below) — pin it to a single instance.

---

## Why the API is pinned to one instance

Three facts, all verified in the code:

1. **State on local disk.** Each run writes PNGs + `result.json` + `series.json`
   under `ICARO_RESULTS_DIR/<run_id>` and reads them back later by `run_id`.
   Cloud Run's filesystem is **per-instance and in-memory (tmpfs)**. With 2+
   instances, a `simulate` on instance A and the results fetch on instance B →
   **404**. So: `min-instances = max-instances = 1`.
2. **`simulate` is process-serialized** by a global lock that also guards
   matplotlib's global state. More than one uvicorn worker would corrupt that —
   so **one worker** (baked into the image's `CMD`).
3. **tmpfs is RAM-backed.** Run artifacts accumulate in memory until the
   instance restarts. Size the service memory with headroom and know that a
   redeploy wipes past runs (acceptable for the MVP).

When persistence lands (GCS), the artifact store becomes stateless — but see the
caveat in [Persistence](#persistence-gcs--firestore): the simulate lock still
pins the API to one instance for now.

---

## Persistence (GCS + Firestore)

The API persists **saved rockets, simulation history, and run artifacts** when
configured for Google Cloud. It is **opt-in**: with the env vars below unset, the
API falls back to ephemeral per-instance storage (local tmpfs + in-memory
metadata) — data is lost on restart and not shared across instances.

The Google client libraries (`google-cloud-storage`, `google-cloud-firestore`)
are **already baked into the API image** (the `[gcp]` extra, installed in the
Dockerfile). No build flag to flip — just provision the resources and set the
env vars below.

**Provision once:**

```bash
# 1. GCS bucket — run artifacts (result.json, series.json, plot PNGs, source .ork)
gcloud storage buckets create gs://PROJECT-icaro-runs \
  --location REGION --uniform-bucket-level-access

# 2. Firestore (Native mode) — metadata: `rockets` + `simulations` collections
gcloud firestore databases create --location REGION   # creates the "(default)" db

# 3. IAM on the API's runtime service account (SA_EMAIL = what the API runs as)
gcloud storage buckets add-iam-policy-binding gs://PROJECT-icaro-runs \
  --member serviceAccount:SA_EMAIL --role roles/storage.objectAdmin
gcloud projects add-iam-policy-binding PROJECT \
  --member serviceAccount:SA_EMAIL --role roles/datastore.user
```

**Point the API at them** (runtime env — no rebuild needed):

```bash
gcloud run services update icaro-api --region REGION \
  --set-env-vars ICARO_GCS_BUCKET=PROJECT-icaro-runs,ICARO_FIRESTORE_PROJECT=PROJECT
  # ICARO_FIRESTORE_DATABASE defaults to "(default)"; set only for a named DB.
```

- Adapter selection is automatic: `ICARO_GCS_BUCKET` set → GCS (else local
  tmpfs); `ICARO_FIRESTORE_PROJECT` set → Firestore (else in-memory). Auth uses
  the service account's Application Default Credentials — **no key file**.
- **Set BOTH** for real persistence. Setting neither = ephemeral (looks like it
  works within one instance, but data vanishes on restart/scale).

> **Caveat — keep the single-instance pin for now.** GCS makes artifact storage
> stateless, but `simulate` is still serialized by a **per-instance** process
> lock guarding matplotlib's global state. With `max-instances > 1` that lock no
> longer serializes globally. Lifting the pin needs a cross-instance lock (or
> moving simulate off the request path) — not done yet. Keep
> `min-instances = max-instances = 1`.

### Composite indexes (org_id + created_at)

Once organizations land (issue #41/#43), `list_rockets`/`list_simulations`
filter by `org_id` **and** order by `created_at DESC`. Firestore requires a
composite index for that combination — declared in
[`apps/api/firestore.indexes.json`](apps/api/firestore.indexes.json) — or the
query fails at **runtime** (not at deploy). Create them once per project:

```bash
gcloud firestore indexes composite create \
  --collection-group=rockets \
  --field-config field-path=org_id,order=ascending \
  --field-config field-path=created_at,order=descending \
  --project=PROJECT

gcloud firestore indexes composite create \
  --collection-group=simulations \
  --field-config field-path=org_id,order=ascending \
  --field-config field-path=created_at,order=descending \
  --project=PROJECT
```

Index builds are asynchronous — check status with
`gcloud firestore indexes composite list --project=PROJECT` before relying on
the filtered queries in production.

### Backfill org_id on existing documents

**Must run — and this PR must merge — before #43** (the `Db` protocol change
that makes `org_id` a required filter). Without it, every pre-existing rocket
and simulation becomes invisible the moment filtering is enabled — a silent
"data loss" that is actually just an unstamped field.

```bash
ICARO_FIRESTORE_PROJECT=PROJECT ICARO_BACKFILL_ORG_ID=<the one org's id> \
  uv run python -m icaro_api.scripts.backfill_org_id
```

It is idempotent and reports `scanned` / `updated` / `already_stamped` counts
per collection — safe to re-run, including after a partial/interrupted run.
Pass `--dry-run` to preview counts without writing. It does **not** create the
organization in Identity Platform (#41's responsibility) — pass its id in.

---

## Build the images

```bash
# API — build context is the REPO ROOT (it bundles the local workspace packages
# + the OpenRocket .jar). Note the trailing "."
docker build -f apps/api/Dockerfile -t REGION-docker.pkg.dev/PROJECT/icaro/api:TAG .

# Web — build context is apps/web (self-contained).
# EVERY web setting below is baked at BUILD time. None of them can be changed
# with a runtime env var on the Cloud Run service — changing any one of them
# means rebuilding and redeploying the image.
#   - NEXT_PUBLIC_FIREBASE_* : Next inlines NEXT_PUBLIC_* into the client bundle.
#   - ICARO_API_ORIGIN       : `rewrites()` is evaluated during `next build` and
#                              the resolved destination is written into
#                              .next/routes-manifest.json (see next.config.ts).
docker build -f apps/web/Dockerfile \
  --build-arg ICARO_API_ORIGIN=https://icaro-api-XXXX.REGION.run.app \
  --build-arg NEXT_PUBLIC_FIREBASE_API_KEY=... \
  --build-arg NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=PROJECT.firebaseapp.com \
  --build-arg NEXT_PUBLIC_FIREBASE_PROJECT_ID=PROJECT \
  -t REGION-docker.pkg.dev/PROJECT/icaro/web:TAG apps/web

docker push REGION-docker.pkg.dev/PROJECT/icaro/api:TAG
docker push REGION-docker.pkg.dev/PROJECT/icaro/web:TAG
```

Both containers listen on `$PORT` (default 8080), as Cloud Run expects. The web
runs as a non-root user.

---

## Identity Platform (auth)

Auth is GCP Identity Platform (Firebase Auth), not a secret the API holds —
there is nothing to create in Secret Manager for it.

**Provision once:**

```bash
# Enable Identity Platform on the project (Console: Identity Platform → Get started),
# then enable the Email/Password sign-in provider.
```

- **API side:** `firebase-admin` verifies session cookies via Application
  Default Credentials — no key file, no env var. Grant the API's runtime
  service account `roles/firebaseauth.admin` (or `roles/identitytoolkit.admin`)
  so it can verify ID tokens and mint/revoke session cookies.
- **Web side:** the browser signs in with the Firebase **client** SDK, which
  needs the project's public web config — not a secret (see
  `apps/web/lib/firebase.ts`). These are `NEXT_PUBLIC_*` vars, inlined into the
  client bundle at **build time** (see [Build the images](#build-the-images)),
  not a runtime env var:
  - `NEXT_PUBLIC_FIREBASE_API_KEY`
  - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
  - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`

  Find these under Console → Project settings → General → Your apps (add a
  Web app if none exists yet).
- Every user needs an `org_id` custom claim (the tenancy boundary) set via
  `firebase_admin.auth.set_custom_user_claims` — there is no self-serve
  org signup yet. Provision users/orgs by hand until that lands.

---

## Deploy — API

```bash
gcloud run deploy icaro-api \
  --image REGION-docker.pkg.dev/PROJECT/icaro/api:TAG \
  --region REGION \
  --min-instances 1 --max-instances 1 \
  --concurrency 8 \
  --cpu 2 --memory 2Gi \
  --timeout 300 \
  --no-allow-unauthenticated \
  --ingress internal
  # Optional:
  #   --set-env-vars ICARO_ALLOW_FORECAST=false   # skip live GFS fetches (faster, no egress)
  #   --set-env-vars ICARO_SESSION_COOKIE_SECURE=false   # local HTTP dev only — never in prod
```

- `--ingress internal` + `--no-allow-unauthenticated` keeps the API off the
  public internet; only the web service reaches it (see the web↔api note below).
- `2Gi`/`2 CPU`/`300s` are starting points — rocketpy + matplotlib are
  CPU/RAM-hungry and the JVM warm-up on the first `convert` is slow. Tune from
  real metrics.
- `ICARO_ORK_JAR` and `ICARO_RESULTS_DIR` are already set in the image; no need
  to pass them.

### web → api link (pick one)

- **Simplest:** drop `--ingress internal`, make the API public
  (`--allow-unauthenticated`). It's still gated by the session cookie + HTTPS.
  Fine for a short-lived MVP.
- **Hardened (recommended):** keep the API `internal` and give the **web**
  service Direct VPC egress so its server-side proxy can reach the API privately.
  External users then cannot hit the API directly at all.

> Note: IAM-authenticated invocation (`--no-allow-unauthenticated` reached via an
> OIDC token) does **not** work transparently here — the Next proxy forwards the
> user's session cookie, not a Google ID token. Use network-level isolation
> (ingress/VPC), not per-request IAM, to lock the API down.

---

## Deploy — web

```bash
gcloud run deploy icaro-web \
  --image REGION-docker.pkg.dev/PROJECT/icaro/web:TAG \
  --region REGION \
  --min-instances 1 --max-instances 4 \
  --concurrency 80 \
  --cpu 1 --memory 512Mi \
  --allow-unauthenticated
```

> **`ICARO_API_ORIGIN` is NOT a runtime env var — do not pass it here.** It is
> baked into the image at build time (see [Build the images](#build-the-images)).
> Setting it on the Cloud Run service has **no effect**: `rewrites()` runs during
> `next build` and the resolved proxy destination is written into
> `.next/routes-manifest.json`; `output: "standalone"` emits no `next.config.js`,
> so nothing re-reads the variable at boot.
>
> Verified on Next 16.2.6: an image built with `ICARO_API_ORIGIN=`
> `http://build-time-canary:1111` and started with
> `ICARO_API_ORIGIN=http://run-time-canary:2222` still tried to reach
> `build-time-canary`.
>
> To point the web at a different API, **rebuild** with
> `--build-arg ICARO_API_ORIGIN=...` and redeploy the new image.
>
> Note the `ARG ICARO_API_ORIGIN` default in `apps/web/Dockerfile` is a specific
> project's API URL. Build without the flag and you silently ship that default —
> always pass it explicitly.

- The web is stateless; scale it freely.

---

## Custom domain

Map `icaro.multitecua.com` to the **web** service (not the API):

```bash
gcloud beta run domain-mappings create \
  --service icaro-web --domain icaro.multitecua.com --region REGION
```

Then add the DNS records Cloud Run returns. (Or front it with a Global External
HTTPS Load Balancer + serverless NEG if you prefer a managed cert + WAF.)

---

## Smoke test

```bash
# Web is up and serving the SPA:
curl -I https://icaro.multitecua.com/

# API is behind the session cookie — GET /api/scenario/template with no
# cookie should 401 (there is no curl-friendly credential to pass anymore):
curl -i https://icaro.multitecua.com/api/scenario/template
```

Then open `https://icaro.multitecua.com/`, sign in with an Identity Platform
account, and run a `.ork` → simulate end-to-end.

---

## Known MVP limitations (by design)

| Limitation | Reason | Future fix |
| --- | --- | --- |
| Runs lost on restart/redeploy | tmpfs is ephemeral | ✅ **Fixed** when GCS + Firestore are configured — see [Persistence](#persistence-gcs--firestore) |
| API can't scale past 1 instance | per-instance simulate lock (matplotlib global state) | GCS removes the disk constraint, but the per-instance lock remains — needs a cross-instance lock to lift the pin |
| No self-serve org signup | `org_id` custom claim is set by hand | admin console / invite flow |
| First `convert` is slow | JVM cold start | `min-instances ≥ 1` already mitigates |
