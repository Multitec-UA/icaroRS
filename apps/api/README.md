# icaro API

A thin **FastAPI** delivery surface over the `icaro` domain. It exposes a JSON
REST API under `/api/*` and also serves a minimal server-rendered (Jinja2)
wizard so the tool is usable in a browser with no front-end build.

**Rule (non-negotiable):** no simulation logic here. If a use-case doesn't exist
in `packages/icaro/` yet, add it there first, then expose it. The API depends on
`icaro`; `icaro` never depends on the API. Presentation concerns that *are* the
API's job — JSON/PNG serialization, HTTP auth, subprocess isolation, elevation
lookup — live here, not in the domain.

## Run it

```bash
# from the repo root
ICARO_BASIC_USER=icaro ICARO_BASIC_PASS=icaro \
  ICARO_ORK_JAR=packages/rocketserializer/OpenRocket-23.09.jar \
  ICARO_RESULTS_DIR=.icaro_runs \
  uv run uvicorn icaro_api.main:app --host 127.0.0.1 --port 8000 --workers 1
```

Then open <http://127.0.0.1:8000/> for the wizard, or call the JSON API directly.
Interactive API docs are at `/docs`.

> **Convert needs Java.** `POST /api/convert` drives the bundled OpenRocket
> `.jar`, which needs **Java ≥ 21** and the `icaro[convert]` extra. Point
> `ICARO_ORK_JAR` at the jar and ensure `JAVA_HOME` is a JDK 21+. Without them,
> convert returns a clean `503` with an install hint (never a crash).

## Endpoints (`/api/*`)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/scenario/template` | Starter scenario + uncertainty presets |
| `POST` | `/api/scenario/validate` | Validate/normalize a scenario → `422` with field errors |
| `GET` | `/api/atmosphere/suggest?date=` | Best atmosphere model for a date (GFS window check) |
| `GET` | `/api/elevation?lat=&lon=` | Ground elevation (best-effort; `503` if unavailable) |
| `POST` | `/api/convert` | Multipart `.ork` upload → `{export_id, manifest}` |
| `POST` | `/api/simulate` | `{export_id, scenario}` → `{run_id, scalars, plot_urls, warnings}` |
| `GET` | `/api/results/{run_id}` | Result envelope `{run_id, status, result}` |
| `GET` | `/api/results/{run_id}/series` | Resampled flight time-series `{t, altitude, speed, mach, acceleration, path3d}` for interactive charts (404 for runs predating the feature) |
| `GET` | `/api/results/{run_id}/plots/{name}.png` | A rendered plot PNG |

The server-rendered wizard lives at `/`, `/step2`, `/step3`, `/results/{run_id}`.

## Auth

Every route is behind **HTTP Basic** (`ICARO_BASIC_USER` / `ICARO_BASIC_PASS`).
The `apps/web` SPA sends the credentials via an `Authorization` header through
its dev proxy; the Jinja wizard relies on the browser's native Basic prompt.

## Configuration (env, prefix `ICARO_`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ICARO_RESULTS_DIR` | `.icaro_runs` | Where run outputs (PNGs, `result.json`) are written |
| `ICARO_ORK_JAR` | — | Path to the OpenRocket `.jar` (for convert) |
| `ICARO_ELEVATION_URL` | open-elevation | DEM lookup endpoint |
| `ICARO_BASIC_USER` | `icaro` | Basic-auth username |
| `ICARO_BASIC_PASS` | `changeme` | Basic-auth password |
| `ICARO_ALLOW_FORECAST` | `false` | Allow real GFS forecast fetches (else suggest standard atmosphere) |

## Design notes

- **Convert runs in a subprocess.** `jpype` can start a JVM only once per
  process, and the OpenRocket helper shuts it down after each conversion — so in
  a long-lived server each convert is isolated in its own short-lived process
  (`services/convert.py` → `services/convert_worker.py`).
- **`Flight` isn't JSON-serializable** (it holds `Function` objects).
  `serialize.py` extracts scalars and renders plot PNGs; a plot whose method
  writes no file is **not** advertised, so the UI never shows a broken image.
- **Simulate is serialized** by a process-wide lock (single worker, MVP) to
  protect matplotlib/global state; `run_id` is always returned for forward-compat
  with an async upgrade.
- `matplotlib.use("Agg")` is set in `main.py` before any pyplot import.

## Ops scripts

- `icaro_api/scripts/backfill_org_id.py` — idempotent backfill that stamps
  `org_id` onto pre-existing `rockets`/`simulations` Firestore documents. See
  [`DEPLOY.md` → Backfill org_id](../../DEPLOY.md#backfill-org_id-on-existing-documents).

## Tests

```bash
cd apps/api
uv run python -m pytest                       # unit suite
uv run python -m pytest -m "not integration"  # skip JVM/network-bound tests
```
