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
| `simulate_from_export(export_dir)` | Build + solve a `Flight` from a RocketSerializer export (`parameters.json` + thrust/drag CSVs). |

## Example

```python
from icaro import simulate_from_export

flight = simulate_from_export("Serializer-export-rockets/v1.5.0")
flight.info()   # presentation is the caller's job
```
