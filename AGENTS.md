# AI Agents Context — icaroRS

This is the **monorepo-level** context. It orients an agent across the whole
repo. For deep, area-specific guidance, follow the pointers below.

## What this repo is

icaroRS is Multitec's rocket simulation monorepo — a **definitive fork** that
evolves independently (no upstream RocketPy syncing). It contains two core
libraries (`rocketpy`, `rocketserializer`), a domain layer (`icaro`), and a
growing set of delivery surfaces (CLI now; API and web planned).

## Layout

```
packages/   libraries (pure, importable): rocketpy, rocketserializer, icaro
apps/       delivery mechanisms (thin shells): cli, api, web
```

## The rule you must not break

**Dependency arrows point one way: `apps → packages`, never the reverse.**

```
apps/{cli,api,web}  →  packages/icaro  →  packages/{rocketpy, rocketserializer}
```

Business logic lives in `packages/icaro` as reusable use-cases and is exposed
(never duplicated) by the surfaces. Packages return objects; they do not print
or format — that is the surface's job (use `warnings.warn` for advisories).

The full contract is in [`ARCHITECTURE.md`](ARCHITECTURE.md). **Read it before
restructuring or adding code.**

## Where to make a change

| You want to… | Work in |
| --- | --- |
| Change the simulation physics | `packages/rocketpy/` — see its `AGENTS.md` |
| Change `.ork` → params conversion | `packages/rocketserializer/` |
| Add/modify a use-case (glue logic) | `packages/icaro/` |
| Add/modify a user-facing command or surface | `apps/` |

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, …).
- **Tests:** run each core's suite from its own directory; see
  [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **Tooling:** uv workspace; `uv sync` to install, `uv run …` to execute.
- **Project-specific conventions & gotchas** (e.g. RocketSerializer test
  patching): `.atl/skill-registry.md`.

## Pointers

- Core engine guidance: [`packages/rocketpy/AGENTS.md`](packages/rocketpy/AGENTS.md)
- Architecture contract: [`ARCHITECTURE.md`](ARCHITECTURE.md)
- Setup & testing: [`CONTRIBUTING.md`](CONTRIBUTING.md)
