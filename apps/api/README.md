# icaro API

A thin **FastAPI** delivery surface over the `icaro` domain. It exposes a JSON
REST API under `/api/*`, consumed by the `apps/web` Next.js UI.

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

Call the JSON API directly, or open <http://127.0.0.1:8000/docs> for the
interactive API docs.

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
| `POST` | `/api/convert` | Multipart `.ork` upload (+ optional `rocket_id` form field to attach it to an existing rocket) → `{export_id, rocket_id, manifest}` |
| `GET` | `/api/rockets` | The org's rockets (a rocket groups the `.ork` files uploaded for it) |
| `GET` | `/api/rockets/{rocket_id}` | Rocket + its exports, newest first |
| `GET` | `/api/exports/{export_id}` | One converted `.ork` with its manifest |
| `GET` | `/api/history?rocket_id=` | Simulation history, optionally one rocket's |
| `POST` | `/api/simulate` | `{export_id, scenario}` → `{run_id, scalars, plot_urls, warnings}` |
| `GET` | `/api/results/{run_id}` | Result envelope `{run_id, status, result}` |
| `GET` | `/api/results/{run_id}/series` | Resampled flight time-series `{t, altitude, speed, mach, acceleration, path3d}` for interactive charts (404 for runs predating the feature) |
| `GET` | `/api/results/{run_id}/plots/{name}.png` | A rendered plot PNG |
| `POST` | `/api/montecarlo` | `{export_id, scenario?, n}` (10 ≤ `n` ≤ 500) → `202 {run_id, status, queue_position}`; queues a Monte Carlo dispersion run |
| `GET` | `/api/montecarlo?rocket_id=&limit=` | The org's Monte Carlo runs, newest first (status + progress, no result) |
| `GET` | `/api/montecarlo/{run_id}` | `{status, progress: {done, total}, queue_position, result, error, …}`; `result` (the dispersed `uncertainty` budget, apogee distribution, impact points, landing/apogee ellipses as `[lat, lon]` polygons) once `done` |
| `GET` | `/api/montecarlo/{run_id}/kml` | The ellipses as KML, served as a download named `montecarlo-{run_id}.kml` (`404` until done, or with < 3 successful flights) |
| `GET` | `/api/real-flights` | `{enabled, flights}`: real MT1 flights from the shared interop collection, newest first (summaries: id, rocket, launch date, pad, stats); `enabled: false` and no flights when the org is not in `ICARO_INTEROP_ORGS` |
| `GET` | `/api/real-flights/{flight_id}` | One real flight, the full `mt-interop/real-flight@1` document (`404` when off for the org) |
| `GET` | `/api/results/{run_id}/compare/{flight_id}` | Simulated vs real: both flights on one time grid (`alt_m`, `vz_ms`, `acc_ms2`), event deltas, KPI deltas, RMSE, warnings. From stored artefacts only, no re-simulation; runs older than the interop payload compare approximately (`approximate: true`). `404` when off, `422` when the real document does not follow the schema |
| `POST` | `/api/launchday` | `{export_id, scenario?, inclinations?, headings?}` → `{wind, current, best, candidates, skipped, limits, checks_current, checks_best}`; recommends the rail setting (synchronous, up to ~1 min) |

`/api/simulate` `scalars` include `rail_departure_stability_margin` (cal,
RocketPy's static margin) and, when computable,
`rail_departure_stability_margin_wind` (cal, with body lift at the rail-exit
angle of attack — the margin OpenRocket reports) and
`rail_departure_angle_of_attack_deg` (deg). Stored runs without the two new
keys keep working; a failure to compute them never fails the run.

## Auth

Every route is behind **HTTP Basic** (`ICARO_BASIC_USER` / `ICARO_BASIC_PASS`).
The `apps/web` SPA sends the credentials via an `Authorization` header through
its dev proxy.

## Configuration (env, prefix `ICARO_`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `ICARO_RESULTS_DIR` | `.icaro_runs` | Where run outputs (PNGs, `result.json`) are written |
| `ICARO_ORK_JAR` | — | Path to the OpenRocket `.jar` (for convert) |
| `ICARO_ELEVATION_URL` | open-elevation | DEM lookup endpoint (open-elevation protocol) |
| `ICARO_ELEVATION_FALLBACK_URL` | Open-Meteo | Tried when the primary fails (Open-Meteo protocol); empty disables it |
| `ICARO_BASIC_USER` | `icaro` | Basic-auth username |
| `ICARO_BASIC_PASS` | `changeme` | Basic-auth password |
| `ICARO_ALLOW_FORECAST` | `false` | Allow real GFS forecast fetches (else suggest standard atmosphere) |
| `ICARO_MONTECARLO_MIN_N` | `10` | Smallest `n` accepted by `POST /api/montecarlo` |
| `ICARO_MONTECARLO_MAX_N` | `500` | Largest `n` accepted by `POST /api/montecarlo` (the CLI has no limit) |
| `ICARO_INTEROP_ORGS` | empty (off) | Comma-separated org ids that take part in the real flight interop: their simulations are published to `interop_simulations`, their users see `interop_real_flights`. See "Real flight interop" below |

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
- **Launch day is a synchronous sweep.** `POST /api/launchday` calls
  `icaro.recommend_rail`: it flies the rocket once per rail (inclination,
  heading) pair, by default 6 inclinations (90° to 80°) × 12 headings (every
  30°), with the scenario's wind (`scenario.wind`, measured on the pad) or the
  atmosphere model's, and recommends the setting that lands closest to the pad.
  It also runs the L1 launch checks for the current and the recommended
  setting. Each grid point is one flight, so a request takes from a few seconds
  to about a minute (under the 300 s Cloud Run timeout); the grid is capped at
  100 candidates and `inclinations` must lie within `[90 − tilt_max, 90]`
  (`422` otherwise). The default limits come from the SURT × SpainRocketry L1
  guide: apogee ≤ 1000 m (≤ 600 m recommended) and tilt ≤ 20° (PROP-003),
  static margin ≥ 1.5 cal through the ascent (PROP-004), descent ≤ 10 m/s
  (5–6 m/s recommended) and landing within 500 m (REC-003), wind ≤ 32 km/h to
  go to the rail (Operativa 5.1), plus a rail exit ≥ 15 m/s practice check.
  It does not take the simulate lock (no matplotlib).
- **Monte Carlo runs are background jobs.** A run takes minutes, so
  `POST /api/montecarlo` records a `queued` run in the Firestore collection
  `montecarlo_runs` and returns `202`. One worker thread per process
  (`services/montecarlo_jobs.py`) runs the jobs one at a time, in order, each
  in its own subprocess (`services/montecarlo_worker.py` →
  `icaro.run_monte_carlo`); progress comes from the line counts of the NDJSON
  output files. The run files are uploaded to
  `orgs/{org}/montecarlo/{run_id}/`. The queue is in memory: on startup, runs
  left `queued`/`running` by a previous process are marked `error`
  (`interrupted by an API restart`). A worker is killed after 30 minutes
  (`error`: `timed out`), or as soon as the queue can no longer record its
  progress, so no orphan keeps burning CPU; the local run directory under
  `ICARO_RESULTS_DIR` (tmpfs on Cloud Run) is removed once the run is uploaded
  or has failed. The record stores the result as a JSON
  string (`result_json`) because Firestore rejects the nested ellipse arrays.
  Listing needs the composite indexes `(org_id, created_at DESC)` and
  `(org_id, rocket_id, created_at DESC)` on `montecarlo_runs`
  (`firestore.indexes.json`). Cloud Run must run with `--no-cpu-throttling`
  (see `DEPLOY.md`).

## Real flight interop (contract `mt-interop` schema v1)

Ícaro and the MT1 flight-telemetry service (Multitec-UA/multi-rocket-avionica)
share the Firestore `(default)` database of the project in
`ICARO_FIRESTORE_PROJECT` (`multitecweb` in production). They never call each
other: each publishes one compact, versioned document per flight into a
collection it owns and reads the other's collection.

| Collection | Writer | Reader |
| --- | --- | --- |
| `interop_simulations/{simulation_id}` | icaro-api (this service) | rocket-flight-telemetry |
| `interop_real_flights/{flight_id}` | rocket-flight-telemetry | icaro-api (this service) |

Common rules: SI units; `t` in seconds with `t = 0` at liftoff (RocketPy's
t = 0 for a simulation); `series` is a map of flat number arrays of equal
length (Firestore forbids nested arrays), at most 2000 points, uniform grid;
`alt_m` is the height above the launch pad; `acc_ms2` is the magnitude of the
specific force, what an accelerometer measures (simulation:
`|a_inertial - g|`; real: `|(ax, ay, az)|`); events are `{id, t, label}` with
`id` in `liftoff, rail_exit, burnout, apogee, ejection, deploy, landing`.
Extra ids and extra fields are allowed; readers ignore what they do not know.

`interop_real_flights/{flight_id}`:

```
schema: "mt-interop/real-flight@1"
flight_id, device_id, rocket            # "MT1"
launch_utc: ISO-8601 | null
pad: {lat, lon, elev_m} | null          # from the recovery data when known
events: [{id, t, label, source}]        # source: "fsm" | "derived"
stats: {apogee_m, apogee_t, vmax_ms, amax_ms2, landing_t}
series: {t, alt_m, vz_ms, acc_ms2}
rate_hz, source_samples, server_version, updated_at
```

`interop_simulations/{simulation_id}`:

```
schema: "mt-interop/simulation@1"
simulation_id, org_id, rocket_id, rocket_name, export_id, export_label
site: {lat, lon, elev_m}, launch_date | null, motor | null
events: [{id, t, label}]                # liftoff 0, rail_exit, burnout, apogee, deploy (one per parachute), landing
stats: {apogee_m, apogee_t, vmax_ms, amax_ms2, flight_time_s}
series: {t, alt_m, vz_ms, speed_ms, acc_ms2, x_m, y_m}
created_at, updated_at
```

How Ícaro fills it: `site`, `events`, `stats` and `series` come from the
domain (`icaro.interop_simulation_payload`); `deploy` is the parachute's
trigger time plus its lag, labelled with the parachute's name; `launch_date`
is the scenario's UTC date and hour (`YYYY-MM-DDTHH:00:00Z`) or null; `motor`
is the export's motor (`"Cesaroni Technology 232H123-14A"`) or null;
`export_label` is the `.ork` file name. Simulations published by the backfill
script from runs older than this feature carry `approximate: true`: their
`vz_ms` is derived from the altitude and they have no `acc_ms2`, no `burnout`
and no `deploy`.

Access boundary: Ícaro publishes a simulation only when its `org_id` is in
`ICARO_INTEROP_ORGS`, and shows real flights only to users of those orgs.
Unset means the feature is off (nothing published, `GET /api/real-flights`
answers `enabled: false`). The telemetry service lists only the simulations
whose `org_id` equals its own `MT1_INTEROP_ICARO_ORG`.

Runtime details:

- `POST /api/simulate` writes the domain payload as `interop.json` next to
  `result.json` (and records it in `artifact_refs.interop_json`), then
  upserts the document. A publishing failure is logged and never fails the
  simulation.
- The real flight list orders by `updated_at` only and selects the summary
  fields, so it needs no composite index; documents without `updated_at` are
  not listed.
- Both service accounts already hold `roles/datastore.user` on the project:
  no new IAM, secret or network path is needed. Each published document holds
  up to 2000 x 7 numbers (about 110 KB); a single-field index exemption on
  `series` in both collections would save index writes, but is not required.
- Backfill of runs made before the feature:
  `uv run python -m icaro_api.scripts.publish_interop_simulations` (dry run;
  `--apply` writes; `--org-id` repeatable, `--limit N`). Same `ICARO_*`
  environment as the API; idempotent (document id = run id, content from the
  stored artefacts, never a re-simulation).

## Ops scripts

- `icaro_api/scripts/backfill_org_id.py` — idempotent backfill that stamps
  `org_id` onto pre-existing `rockets`/`simulations` Firestore documents. See
  [`DEPLOY.md` → Backfill org_id](../../DEPLOY.md#backfill-org_id-on-existing-documents).
- `icaro_api/scripts/migrate_rocket_exports.py` — idempotent, rollback-safe
  split of the legacy per-file `rockets` documents into `rockets` (groups) +
  `exports` (converted files), and `export_id` on simulations; the legacy
  fields stay on the rocket documents until `--drop-legacy-fields`. See
  [`DEPLOY.md` → Migrate rockets](../../DEPLOY.md#migrate-rockets--rockets--exports).
- `icaro_api/scripts/publish_interop_simulations.py`: idempotent publish of the
  existing simulations of the `ICARO_INTEROP_ORGS` orgs to
  `interop_simulations`; dry run unless `--apply`. See "Real flight interop".

## Tests

```bash
cd apps/api
uv run python -m pytest                       # unit suite
uv run python -m pytest -m "not integration"  # skip JVM/network-bound tests
```
