# Architecture

icaroRS is a **monorepo**. This document is the contract that keeps it from
rotting into a tangle. Read it before adding code or moving things around.

## Two worlds: `packages/` and `apps/`

Everything in the repo is one of two kinds of thing. Confusing them is the #1
way a monorepo decays.

| | `packages/` | `apps/` |
| --- | --- | --- |
| **What** | Libraries | Delivery mechanisms |
| **Have** | functions, classes | entry points (CLI command, HTTP server, UI) |
| **Never have** | `main`, servers, arg parsing, HTTP | thick business logic |
| **Importable by** | anyone | nobody (they are the leaves) |

A **package** is pure, importable code. It exposes an API and does its job
without knowing who calls it.

An **app** is a thin shell that connects a package to the outside world (a
terminal, an HTTP client, a browser). It parses input, calls a package, and
presents the result.

## The one rule that matters

> **Dependency arrows point one way: `apps → packages`. Never the reverse.**

The CLI knows about `icaro`; `icaro` does not know the CLI exists. The API will
know about `icaro`; `icaro` will never import the API. If you ever feel the urge
to import something from `apps/` inside a package, stop — the logic is in the
wrong place.

Within `packages/`, the arrows also point one way:

```
apps/{cli,api,web}  →  packages/icaro  →  packages/{rocketpy, rocketserializer}
```

## The components

| Path | Kind | Responsibility |
| --- | --- | --- |
| `packages/rocketpy` | core lib | 6-DOF flight simulation engine. |
| `packages/rocketserializer` | core lib | Convert OpenRocket `.ork` files into parameters. |
| `packages/icaro` | domain | Use-cases that orchestrate the cores (e.g. `simulate_from_export`). The reusable heart. |
| `apps/cli` | delivery | `icaro` command — first real surface. |
| `apps/api` | delivery | FastAPI REST surface (`/api/*`). Thin adapter over `icaro`. |
| `apps/web` | delivery | React/Next.js web UI. Consumes the frozen `/api` contract; **not** a uv member (Node project). |

## Why a domain layer (`icaro`)

The valuable logic of icaroRS is *gluing the cores together* — "take a
serialized rocket, simulate it, give me the result". That logic must live in
exactly **one** place, or it gets copy-pasted into the CLI, then the API, then
the web, and the day it changes you fix it in one and break the other two.

So it lives in `packages/icaro` as a use-case. Every surface calls the same
function. This is the hexagonal idea: the use-case sits in the center, the
delivery mechanisms are interchangeable adapters around it.

## How to add things

**A new behaviour (e.g. "serialize an .ork", "run a Monte Carlo dispersion"):**
1. Add a use-case function in `packages/icaro` (pure, returns data/objects).
2. Expose it from each surface that needs it (a CLI subcommand, an API route).

**A new delivery surface:** add a folder under `apps/`, depend on `icaro`, keep
it thin. Never reach past `icaro` into the cores from a surface unless there is
a deliberate reason.

**Presentation belongs in the surface.** A package returns a `Flight`; it does
not `print` it. For advisory signals inside a package use `warnings.warn` and
let the caller decide how to show them.

## Tooling

The repo is a [uv](https://docs.astral.sh/uv/) workspace (`pyproject.toml` at
the root). `uv sync` installs every package and app editable and cross-links the
local versions, so `icaro` resolves to `packages/icaro`, not a PyPI release of
the same name. See `CONTRIBUTING.md` for setup.
