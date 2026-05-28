# AI Agents Context for icaroRS

> **Monorepo context**: This repo is `icaroRS` — Multitec's unified rocket simulation project. It contains TWO Python libraries: `rocketpy/` (RocketPy core, at the root) and `packages/RocketSerializer/rocketserializer/` (RocketSerializer subpackage). The library names (`rocketpy` and `rocketserializer`) are intentionally preserved — they match the upstream API. Only the **monorepo / repo** identity changed to icaroRS.
>
> For RocketSerializer-specific conventions and gotchas, see `.atl/skill-registry.md`.

The rest of this document describes the **RocketPy core library** conventions specifically.

---

Welcome, AI Agent! This file provides essential context, architectural understanding, and guidelines for interacting with the RocketPy code (at the repo root, under `rocketpy/`). Please read this carefully to ensure your contributions align with the project's goals.

## Project Overview

**RocketPy** is the next-generation trajectory simulation solution for High-Power Rocketry. It is a highly accurate Python library enabling a complete 6 degrees of freedom (6-DOF) simulation of a rocket's flight trajectory.

**Core Capabilities:**
- Nonlinear 6-DOF simulations with rigorous treatment of mass variation.
- Accurate weather and atmospheric modeling (International Standard Atmosphere, custom weather forecasts).
- Aerodynamic models (Barrowman equations, custom CFD import).
- Complex structures: Parachutes with triggers, Solid/Hybrid/Liquid motors, Multi-stage rockets.
- Monte Carlo simulations for dispersion and sensitivity analysis.

## Technical Stack & Architecture

- **Language:** Python
- **Core Abstractions:** The library is organized logically into four main pillars:
  1. `Environment`: Manages atmospheric conditions, elevation, and location coordinates.
  2. `Motor` (`SolidMotor`, `HybridMotor`, `LiquidMotor`): Contains propulsion parameters, thrust curves, and mass variation properties.
  3. `Rocket`: Reassembles the vehicle's geometry, aerodynamic properties, parachutes (`add_parachute`), fins, and nose cones.
  4. `Flight`: Combines an `Environment` and a `Rocket` configuration, handling the ODE solving (using LSODA) and generating trajectory results and plots.

## Code Style & Development Rules

1. **Code Formatting:** The project adheres to **Black** (code style). Ensure any Python code you write or modify is formatted accordingly.
2. **Scientific Precision:** RocketPy is a validated engineering tool (validated against real flights like EPFL and NDRT). Do not introduce approximations or hardcoded physical constants unless rigorously justified. Maintain precision.
3. **Performance:** Core calculations must be efficient, as they are often run thousands of times during Monte Carlo simulations.
4. **Documentation:** Maintain clear, descriptive docstrings for new properties and methods. Refer to the mathematical models or physics equations being used where applicable.
5. **Modularity:** Ensure the codebase remains flexible. Users expect to easily extend the library or use custom discrete/continuous control laws without modifying the core engine.

## Agent Guidelines for Contributions

- **Preserve the API:** The flow of setting up a simulation (`Environment` -> `Motor` -> `Rocket` -> `Flight`) is the signature of RocketPy. Keep this API intuitive and user-friendly.
- **Do your research:** Before adding new physical components, see how existing ones (like fins or tail) are added to the `Rocket` class.
- **Remind about Validation:** If you modify formulas related to drag, thrust, or wind interpolation, advise the user to run the test suite and check for trajectory regressions.

## Helpful Resources
- **Documentation:** [docs.rocketpy.org](https://docs.rocketpy.org/)
- **Code:** Hosted on GitHub at [RocketPy-Team/RocketPy](https://github.com/RocketPy-Team/RocketPy)
