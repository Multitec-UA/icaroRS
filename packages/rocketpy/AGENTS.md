# AI Agents Context — RocketPy core

This covers the **RocketPy core library** (`packages/rocketpy/rocketpy/`). For
monorepo-wide context and the dependency rules, see the root
[`AGENTS.md`](../../AGENTS.md) and [`ARCHITECTURE.md`](../../ARCHITECTURE.md).

## Overview

**RocketPy** is a next-generation trajectory simulation solution for High-Power
Rocketry — a highly accurate Python library enabling complete 6 degrees of
freedom (6-DOF) simulation of a rocket's flight trajectory.

**Core capabilities:**
- Nonlinear 6-DOF simulations with rigorous treatment of mass variation.
- Accurate weather and atmospheric modeling (International Standard Atmosphere,
  custom weather forecasts).
- Aerodynamic models (Barrowman equations, custom CFD import).
- Complex structures: parachutes with triggers, solid/hybrid/liquid motors,
  multi-stage rockets.
- Monte Carlo simulations for dispersion and sensitivity analysis.

## The four pillars

The library is organized around four main abstractions:

1. **`Environment`** — atmospheric conditions, elevation, location coordinates.
2. **`Motor`** (`SolidMotor`, `HybridMotor`, `LiquidMotor`) — propulsion
   parameters, thrust curves, mass-variation properties.
3. **`Rocket`** — vehicle geometry, aerodynamic properties, parachutes
   (`add_parachute`), fins, nose cones.
4. **`Flight`** — combines an `Environment` and a `Rocket`, solves the ODE
   (LSODA), and produces trajectory results and plots.

## Rules

1. **Code style:** Black + Ruff (config in this package's `pyproject.toml`).
2. **Scientific precision:** RocketPy is a validated engineering tool (validated
   against real flights such as EPFL and NDRT). Do not introduce approximations
   or hardcoded physical constants unless rigorously justified.
3. **Performance:** core calculations run thousands of times in Monte Carlo
   runs — keep them efficient.
4. **Documentation:** clear, descriptive docstrings; reference the mathematical
   models / physics equations where applicable.
5. **Modularity:** users extend the library and supply custom control laws
   without modifying the core engine — keep it flexible.

## Contribution guidelines

- **Preserve the API.** The setup flow `Environment → Motor → Rocket → Flight`
  is the signature of RocketPy. Keep it intuitive.
- **Do your research.** Before adding a physical component, study how existing
  ones (fins, tail) are added to `Rocket`.
- **Remind about validation.** If you change formulas for drag, thrust, or wind
  interpolation, advise running the suite and checking for trajectory
  regressions.

## Tests

Run from this directory (`packages/rocketpy/`) — fixtures use paths relative to
it:

```bash
uv run pytest tests/unit
uv run pytest tests/integration
uv run pytest tests/acceptance
```

## Resources

- Original project documentation: <https://docs.rocketpy.org/>
- Upstream (reference only; icaroRS does not sync from it):
  [RocketPy-Team/RocketPy](https://github.com/RocketPy-Team/RocketPy)
