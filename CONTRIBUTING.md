# Contributing

## Prerequisites

- **Python ≥ 3.10**
- **[uv](https://docs.astral.sh/uv/)** — `brew install uv` (recommended workflow)
- **Java 21** — for RocketSerializer's acceptance tests and the API's
  `/api/convert` (both drive the bundled OpenRocket `.jar`). Not needed for
  RocketPy or the CLI.
- **Node ≥ 20** — only for the web UI (`apps/web`), a standalone npm/Next.js
  project. Not needed for the Python packages, CLI, or API.

## Setup

```bash
uv sync          # installs every package + app, editable and cross-linked
```

This wires the workspace so local packages resolve to each other (`icaro` →
`packages/icaro`, not a PyPI package of the same name).

<details>
<summary>Plain pip (no uv)</summary>

Install each local package editable, and use <code>--no-deps</code> for the
internal ones so pip doesn't pull the upstream <code>rocketpy</code> from PyPI:

```bash
python3 -m venv .venv && source .venv/bin/activate
python3 -m pip install -e packages/rocketpy
python3 -m pip install -e packages/rocketserializer
python3 -m pip install -e packages/icaro --no-deps
python3 -m pip install -e apps/cli --no-deps && python3 -m pip install "typer>=0.12"
```
</details>

## Running the CLI

```bash
uv run icaro simulate Serializer-export-rockets/v1.5.0
```

## Running the API

```bash
ICARO_BASIC_USER=icaro ICARO_BASIC_PASS=icaro \
  ICARO_ORK_JAR=packages/rocketserializer/OpenRocket-23.09.jar \
  uv run uvicorn icaro_api.main:app --port 8000 --workers 1
```

Wizard at <http://127.0.0.1:8000/>, JSON docs at `/docs`. Full env/endpoint
reference: [`apps/api/README.md`](apps/api/README.md).

## Running the web app

`apps/web` is a standalone Next.js project — it talks to the API over a dev
proxy, so start the API first (above), then:

```bash
cd apps/web
npm install        # first time only
npm run dev        # http://localhost:3000
```

See [`apps/web/README.md`](apps/web/README.md) for the proxy/auth model.

## Running tests

Each core library has its own suite and **must be run from its own directory**
(tests reference data via paths relative to the package root).

**RocketPy core:**

```bash
cd packages/rocketpy
uv run pytest tests/unit
uv run pytest tests/integration
uv run pytest tests/acceptance
```

The sensitivity tests need the `monte-carlo` extra (`statsmodels`); install it
if you touch that area.

**RocketSerializer core** (acceptance tests need Java 21):

```bash
cd packages/rocketserializer
uv run pytest tests/unit
uv run pytest tests/acceptance        # JVM-bound; requires Java 21 + OpenRocket jar
```

**icaro domain + API** (pure unit tests; no JVM/network):

```bash
uv run python -m pytest packages/icaro/tests
cd apps/api && uv run python -m pytest -m "not integration"
```

**Web app** (`apps/web`):

```bash
cd apps/web
npm run lint
npx tsc --noEmit
npm run build
```

CI runs the same suites — see `.github/workflows/`.

## Code style

- **RocketPy core** follows **Black** + **Ruff** (config in
  `packages/rocketpy/pyproject.toml`). It is a validated engineering tool — do
  not introduce approximations or hardcoded physical constants without rigorous
  justification, and keep scientific precision.
- New domain/app code: match the style of the package you are in.

## Commits

Use **[Conventional Commits](https://www.conventionalcommits.org/)**
(`feat:`, `fix:`, `refactor:`, `docs:`, `ci:`, …). Scope by area when it helps:
`feat(icaro): …`, `refactor(monorepo): …`.

## Issues & approval workflow

Work starts from an issue, not a stray PR.

1. **Open an issue** with a template — 🐞 Bug Report or 🚀 Feature Request
   (blank issues are disabled). It is auto-labeled `status:needs-review`.
2. **A maintainer reviews it** and adds `status:approved` (optionally a
   `priority:*` label) once it is accepted and in scope.
3. **Only then open a PR**, and link it to the approved issue
   (`Closes #N`). PRs without an approved issue may be asked to wait.

Open-ended questions go to **Discussions**, not issues.

## Where does my change go?

See [`ARCHITECTURE.md`](ARCHITECTURE.md). Short version: business logic →
`packages/icaro`; a new user-facing surface → `apps/`; changes to the simulation
engine or the serializer → the respective core under `packages/`.
