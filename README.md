# icaroRS

Multitec's rocket simulation monorepo. It bundles two core libraries and builds
a single, growing toolkit on top of them: a **CLI**, a **REST API**, and a
**web interface** — all thin surfaces over one shared domain layer.

- **RocketPy** — advanced 6-DOF trajectory simulation for high-power rocketry.
- **RocketSerializer** — converts OpenRocket `.ork` files into simulation
  parameters.
- **icaro** — the domain layer that orchestrates both into reusable use-cases.

> icaroRS is a definitive fork; it evolves independently and no longer syncs
> from upstream RocketPy.

## Layout

```
icaroRS/
├── packages/                 # libraries (pure, importable)
│   ├── rocketpy/             #   core: 6-DOF simulation engine
│   ├── rocketserializer/     #   core: OpenRocket → parameters
│   └── icaro/                #   domain: use-cases gluing the cores
└── apps/                     # delivery mechanisms (thin shells)
    ├── cli/                  #   `icaro` command
    ├── api/                  #   FastAPI REST API + server-rendered wizard
    └── web/                  #   React/Next.js web UI
```

The rules behind this layout — what goes in `packages/` vs `apps/`, and which
way dependencies are allowed to point — live in
[`ARCHITECTURE.md`](ARCHITECTURE.md). Read it before adding code.

## Quickstart

icaroRS uses a [uv](https://docs.astral.sh/uv/) workspace. One command installs
every package and app, editable and cross-linked:

```bash
uv sync
```

Run a flight simulation from a serialized rocket:

```bash
uv run icaro simulate Serializer-export-rockets/v1.5.0
```

That prints a full flight summary (apogee, max velocity, parachute events,
impact). The simulation logic itself lives in `packages/icaro`; the CLI is just
the surface that shows it.

> No `uv`? Install it with `brew install uv` (recommended). A plain `pip`
> workflow is possible but more manual — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Components

| Component | Docs |
| --- | --- |
| RocketPy core | [`packages/rocketpy/README.md`](packages/rocketpy/README.md) |
| RocketSerializer core | [`packages/rocketserializer/README.md`](packages/rocketserializer/README.md) |
| icaro domain | [`packages/icaro/README.md`](packages/icaro/README.md) |
| CLI | [`apps/cli/README.md`](apps/cli/README.md) |
| REST API + wizard | [`apps/api/README.md`](apps/api/README.md) |
| Web UI (React/Next.js) | [`apps/web/README.md`](apps/web/README.md) |

## Deployment (Multitec hosted instance)

A managed instance lives in the **`multitecweb`** GCP project (region `europe-west1`).

| Surface | URL |
| --- | --- |
| Web (Next 16 SPA) | <https://icaro.multitecua.com> |
| API (FastAPI + JDK 21 + OpenRocket) | *no public URL* — see below |

The API is deployed with `ingress: INTERNAL_ONLY`. It has no public domain and the
underlying `*.run.app` URL returns `404` to any external caller — the only legitimate
client is `icaro-web`'s server-side proxy, which reaches `icaro-api` through direct
VPC egress (`mt-vpc`). All HTTP traffic to `/api/*` therefore enters the system at
`icaro.multitecua.com`, passes through Next's rewrite, and only then reaches the
FastAPI app.

Auth is HTTP Basic; credentials are stored in Secret Manager
(`mt-icaro-api-basic-user`, `mt-icaro-api-basic-pass`) and never live in code or
CI substitutions. Ask `@sergio` for the demo password.

Both services build automatically on every push to `main`:

- `mt-icaro-api` rebuilds when `packages/**`, `apps/api/**`, `apps/cli/**`,
  `pyproject.toml`, or `uv.lock` change.
- `mt-icaro-web` rebuilds when `apps/web/**` changes.

Infrastructure is declared in [`Multitec-UA/multitec-terrafrom`](https://github.com/Multitec-UA/multitec-terrafrom)
under `settings/multitecweb.yaml` (entries `app.service.icaro-api` and
`app.service.icaro-web`). Operational runbook lives in [`DEPLOY.md`](DEPLOY.md).

## Contributing & testing

Environment setup, per-package test commands, and code style live in
[`CONTRIBUTING.md`](CONTRIBUTING.md). Agent/automation context is in
[`AGENTS.md`](AGENTS.md).

## License

MIT — see [`LICENSE`](LICENSE).
