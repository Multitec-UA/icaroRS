# icaroRS

Multitec's rocket simulation monorepo. It bundles two core libraries and builds
a single, growing toolkit on top of them: a CLI today, a REST API and a web
interface tomorrow.

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
    ├── cli/                  #   `icaro` command (available now)
    ├── api/                  #   REST API (planned)
    └── web/                  #   web UI (planned)
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

## Contributing & testing

Environment setup, per-package test commands, and code style live in
[`CONTRIBUTING.md`](CONTRIBUTING.md). Agent/automation context is in
[`AGENTS.md`](AGENTS.md).

## License

MIT — see [`LICENSE`](LICENSE).
