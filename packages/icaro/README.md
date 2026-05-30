# icaro — domain layer

The heart of icaroRS. Reusable **use-cases** that orchestrate the core
libraries into meaningful operations. Every delivery surface (CLI, API, web)
calls into this package — the logic lives here exactly once.

## Rules

- **Pure logic, no presentation.** Functions build and return objects (e.g. a
  RocketPy `Flight`); they never `print` or format for a screen. Use
  `warnings.warn` for advisory signals and let the caller decide how to surface
  them.
- **Depends on cores, never on apps.** `icaro` may import `rocketpy` /
  `rocketserializer`. Nothing in `apps/` may be imported here.

## Current use-cases

| Function | What it does |
| --- | --- |
| `simulate_from_export(export_dir, scenario=None)` | Build + solve a `Flight` from a RocketSerializer export (`parameters.json` + thrust/drag CSVs). An optional `Scenario` overrides site, atmosphere, rail. |
| `convert_ork(...)` | Convert an OpenRocket `.ork` into an export directory. Needs the `icaro[convert]` extra + Java; raises `ConvertUnavailableError` otherwise. Lazy-imports rocketserializer. |
| `load_scenario(path)` | Load and validate a scenario YAML into a `Scenario`. |
| `Scenario` | Pydantic model for a simulation scenario: site, launch date, atmosphere model + fallback, rail overrides, uncertainty budget. |
| `choose_atmosphere_model_for_date(date, online=True)` | Pick the best atmosphere model (real GFS `forecast` vs `standard_atmosphere`) for a launch date. |
| `gfs_window_check(date)` | Whether a date falls inside the ~16-day GFS forecast window. |

> Monte Carlo, sensitivity, and comparison use-cases are planned (issues
> [#2](https://github.com/Multitec-UA/icaroRS/issues/2),
> [#3](https://github.com/Multitec-UA/icaroRS/issues/3),
> [#4](https://github.com/Multitec-UA/icaroRS/issues/4)).

## Example

```python
from icaro import simulate_from_export

flight = simulate_from_export("Serializer-export-rockets/v1.5.0")
flight.info()   # presentation is the caller's job
```
