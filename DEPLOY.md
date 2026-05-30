# Deploying icaro to Cloud Run

This is the hand-off doc for infra. It tells you **what to deploy, with which
settings, and why** — so you own the `gcloud`/Terraform without needing the app
internals. The repo ships the two Dockerfiles; this doc is the runbook.

> **Scope: MVP.** Goal is to expose the app at `icaro.multitecua.com` for the
> team to try. **Run data is ephemeral and may be lost on any restart/redeploy —
> that is accepted for now.** Persistence + history + members/organizations are
> planned next; the storage layer is already isolated behind a seam
> (`apps/api/icaro_api/runs.py` + `serialize.py`) so swapping local disk → GCS
> later won't touch the domain.

---

## Architecture — two services

```
                    icaro.multitecua.com
                            │  (HTTPS, public)
                            ▼
                   ┌──────────────────┐        proxies /api/* (server-side)
   browser ───────▶│   web  (Next 16) │ ───────────────────────────────┐
   (Basic creds    └──────────────────┘                                 │
    typed in the     stateless, scales freely                           ▼
    app's AuthGate)                                          ┌──────────────────────┐
                                                             │   api  (FastAPI)      │
                                                             │   JDK 21 + OpenRocket │
                                                             │   max-instances = 1   │
                                                             └──────────────────────┘
                                                               stateful on /tmp (tmpfs)
```

- **web** is the public face. It serves the SPA and **proxies `/api/*`** to the
  API at `ICARO_API_ORIGIN` (server-side rewrite — to the browser everything is
  same-origin, so no CORS). The incoming `Authorization` (HTTP Basic) header is
  forwarded to the API, so app-level auth works through the proxy.
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

When persistence lands (GCS), the API becomes stateless and this pin can be
lifted.

---

## Build the images

```bash
# API — build context is the REPO ROOT (it bundles the local workspace packages
# + the OpenRocket .jar). Note the trailing "."
docker build -f apps/api/Dockerfile -t REGION-docker.pkg.dev/PROJECT/icaro/api:TAG .

# Web — build context is apps/web (self-contained).
docker build -f apps/web/Dockerfile -t REGION-docker.pkg.dev/PROJECT/icaro/web:TAG apps/web

docker push REGION-docker.pkg.dev/PROJECT/icaro/api:TAG
docker push REGION-docker.pkg.dev/PROJECT/icaro/web:TAG
```

Both containers listen on `$PORT` (default 8080), as Cloud Run expects. The web
runs as a non-root user.

---

## Secrets (Secret Manager — never bake them)

The API's HTTP Basic credentials are the only secrets. Create them once:

```bash
printf 'icaro'                | gcloud secrets create icaro-basic-user --data-file=-
printf 'A-STRONG-PASSWORD'    | gcloud secrets create icaro-basic-pass --data-file=-
```

Grant the API's runtime service account `roles/secretmanager.secretAccessor` on
both, then mount them as env vars (below).

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
  --ingress internal \
  --set-secrets ICARO_BASIC_USER=icaro-basic-user:latest,ICARO_BASIC_PASS=icaro-basic-pass:latest
  # Optional:
  #   --set-env-vars ICARO_ALLOW_FORECAST=false   # skip live GFS fetches (faster, no egress)
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
  (`--allow-unauthenticated`). It's still gated by HTTP Basic + HTTPS. Fine for a
  short-lived MVP.
- **Hardened (recommended):** keep the API `internal` and give the **web**
  service Direct VPC egress so its server-side proxy can reach the API privately.
  External users then cannot hit the API directly at all.

> Note: IAM-authenticated invocation (`--no-allow-unauthenticated` reached via an
> OIDC token) does **not** work transparently here — the Next proxy forwards the
> user's Basic header, not a Google ID token. Use network-level isolation
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
  --allow-unauthenticated \
  --set-env-vars ICARO_API_ORIGIN=https://icaro-api-XXXX.REGION.run.app
```

- `ICARO_API_ORIGIN` is read at **server boot** (in `next.config.ts` rewrites),
  so it's a normal runtime env — set it to the API service URL. No rebuild needed
  to change it.
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

# API behind Basic auth (through the web proxy):
curl -u "$ICARO_BASIC_USER:$ICARO_BASIC_PASS" \
  https://icaro.multitecua.com/api/scenario/template
```

Then open `https://icaro.multitecua.com/`, enter the Basic credentials in the
app, and run a `.ork` → simulate end-to-end.

---

## Known MVP limitations (by design)

| Limitation | Reason | Future fix |
| --- | --- | --- |
| Runs lost on restart/redeploy | tmpfs is ephemeral | GCS-backed storage |
| API can't scale past 1 instance | per-instance disk + simulate lock | GCS → stateless API |
| Shared Basic-auth credential | no user model yet | members/organizations + IAP/OAuth |
| First `convert` is slow | JVM cold start | `min-instances ≥ 1` already mitigates |
