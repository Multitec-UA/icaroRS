# Contributing

## Prerequisites

- **Python ≥ 3.10**
- **[uv](https://docs.astral.sh/uv/)** — `brew install uv` (recommended workflow)
- **Java 21** — only for RocketSerializer's acceptance tests, which drive the
  bundled OpenRocket `.jar`. Not needed for RocketPy or the CLI.

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

## Where does my change go?

See [`ARCHITECTURE.md`](ARCHITECTURE.md). Short version: business logic →
`packages/icaro`; a new user-facing surface → `apps/`; changes to the simulation
engine or the serializer → the respective core under `packages/`.
