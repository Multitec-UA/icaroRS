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
| `wind_stability_margin(flight, rocket, params, k=1.1)` | Rail-exit stability margin with body lift, the one OpenRocket reports. RocketPy's CP depends on Mach only; OpenRocket also adds the lift of the nose cone, tubes and transitions at the actual angle of attack (`K·A_plan/A_ref·sin²α/α`, K = 1.1, at each segment's planform centroid), which moves the CP forward when the wind tilts the airflow at rail exit. Reporting only: the trajectory is unchanged. Returns a `WindMarginResult` (`static_cal` = `out_of_rail_stability_margin`, `wind_cal`, `angle_of_attack_deg`, `cp_static`, `cp_wind` in rocket coordinates, `used_fallback`); at zero angle of attack `wind_cal == static_cal` exactly. The body comes from the export's `body_segments` (planform exact for ellipsoid and conical noses and all tubes/transitions, trapezoid approximation for other nose shapes); exports without it fall back to the nose cone plus one tube of the rocket radius to the aft-most of fins, tail and nozzle, with a warning and `used_fallback=True`. `simulate_from_export` attaches it as `flight.wind_stability` (`None`, with a warning, when it cannot be computed). |
| `convert_ork(...)` | Convert an OpenRocket `.ork` into an export directory. Needs the `icaro[convert]` extra + Java; raises `ConvertUnavailableError` otherwise. Lazy-imports rocketserializer. |
| `load_scenario(path)` | Load and validate a scenario YAML into a `Scenario`. |
| `Scenario` | Pydantic model for a simulation scenario: site, launch date, atmosphere model + fallback, rail overrides, manual `wind`, uncertainty budget. |
| `Wind` | Manual pad wind for a `Scenario`: `speed` (m/s, ≥ 0) and `direction_from` (degrees, where the wind comes FROM, 0 ≤ x < 360; 270 = from the west). It replaces the atmosphere's wind with a constant wind at every altitude; pressure/temperature then follow the standard atmosphere (warned when a real model is replaced). |
| `choose_atmosphere_model_for_date(date, online=True)` | Pick the best atmosphere model (real GFS `forecast` vs `standard_atmosphere`) for a launch date. |
| `gfs_window_check(date)` | Whether a date falls inside the ~16-day GFS forecast window. |
| `run_monte_carlo(export_dir, scenario, n, output_prefix, *, parallel=False, workers=None, on_progress=None)` | Run `n` stochastic flights within the scenario's `uncertainty` budget (`DEFAULT_UNCERTAINTY` when absent or empty). Writes NDJSON `{prefix}.inputs.txt` / `.outputs.txt` / `.errors.txt` (one JSON object per line; failed flights go to `.errors.txt` and the run continues) and a landing-ellipse `{prefix}.kml`. Returns a `MonteCarloResult`: the dispersed `uncertainty` budget, apogee AGL distribution and stats, impact points, 1σ/2σ/3σ landing and apogee ellipses as `(lat, lon)` polygons, and `to_dict()` for JSON. `on_progress(done, total)` is called from a watcher thread and always last with `(n, n)`. |
| `build_stochastic(export_dir, scenario)` | The RocketPy stochastic models behind `run_monte_carlo`. `mass`, `thrust` (motor total impulse), `inclination`, `heading`, `rail_length` and `wind_factor` are dispersed; a `relative` std is a fraction of the nominal value, an `absolute` std is in the parameter's unit (degrees for angles). Unknown keys raise `ValueError`. |
| `recommend_rail(export_dir, scenario, inclinations=(90, 88, 86, 84, 82, 80), headings=range(0, 360, 30), limits=LaunchLimits())` | Launch-day rail advisor. Builds the scenario once (`build_nominal_flight`; that flight is `current`), then flies one deterministic flight per (inclination, heading) with the same rocket and environment. Returns a `RailSweep`: `wind` used (`manual`, or the `model` wind at pad height + 10 m), `current`, `best` (closest landing among candidates passing every hard L1 check, else the closest overall), `candidates` sorted by landing distance, `skipped` (flights that raised), `limits`, `checks_current` / `checks_best`, and `to_dict()` for JSON. Inclinations must lie in `[90 - tilt_max_deg, 90]`, headings in `[0, 360)`, and the grid holds at most 100 points (`ValueError` otherwise). RocketPy output is silenced. |
| `evaluate_rail(export_dir, scenario, inclination, heading, limits=LaunchLimits())` | One rail setting as a `RailCandidate` (`apogee_agl`, `landing_distance`, `landing_bearing` from north, `out_of_rail_velocity`, `stability_margin_min` from rail exit to apogee, positive `impact_velocity`, `checks_ok`). `None` keeps the scenario's/export's value. |
| `launch_checks(candidate, wind_speed_ms, limits=LaunchLimits())` | The SURT x SpainRocketry L1 checklist as `LaunchCheck`s (`id`, `value`, `limit`, `comparator` `<=`/`>=`/`between`, `ok`, `severity` `hard`/`soft`, `source`): `apogee_max`, `apogee_recommended`, `tilt_max` (value = 90 − inclination), `static_margin_min`, `descent_max`, `descent_recommended`, `landing_radius`, `rail_exit_min` (source `practice`: not in the guide), `wind_max` (value in km/h). Numbers only; labels are the surfaces' job. |
| `LaunchLimits` | L1 limits, Nov 2026 guide rev. 5: apogee ≤ 1000 m (hard) / ≤ 600 m (soft), tilt ≤ 20°, static margin ≥ 1.5 cal through the ascent, descent ≤ 10 m/s (hard) / 5–6 m/s (soft), landing ≤ 500 m (soft), rail exit ≥ 15 m/s (soft, practice), wind ≤ 32 km/h (hard). |
| `interop_simulation_payload(flight, max_points=2000)` | The flight-derived part of an `mt-interop/simulation@1` document (the real flight interop contract, see `apps/api/README.md`): `site` (`lat`, `lon`, `elev_m` of the environment), `events` (`liftoff` 0, `rail_exit`, `burnout`, `apogee`, one `deploy` per parachute at trigger time plus lag, `landing`), `stats` (`apogee_m` above the pad, `apogee_t`, `vmax_ms`, `amax_ms2`, `flight_time_s`) and `series` on a uniform grid of at most 2000 points from t = 0 (RocketPy's t = 0): `t`, `alt_m`, `vz_ms`, `speed_ms`, `acc_ms2` (specific force `|a_inertial - g|`, what an accelerometer reads), `x_m` (East), `y_m` (North). Solver output is interpolated linearly between nodes (the splines ring across a parachute opening). |
| `interop_simulation_from_series(series, scalars, site=None)` | The same shape, approximately, from what a run stored before the payload existed (chart `series.json` + scalars): `vz_ms` derived from the altitude, no `acc_ms2`, no `burnout`/`deploy` events, `approximate: True`. Raises `InteropSchemaError` without usable `t`/`altitude`. |
| `compare_with_real_flight(sim_payload, real_doc, max_points=1000)` | Simulated vs real flight. Validates `real_doc["schema"] == "mt-interop/real-flight@1"` (and the simulation schema when the payload carries one), else `InteropSchemaError`; unknown event ids are ignored. Returns a `FlightComparison`: `alt_m`, `vz_ms`, `acc_ms2` of both sides on one uniform grid spanning both flights (`None` outside a side's range; the step is never finer than the coarser input), `events` (sim t, real t, delta, and the altitude for `apogee`/`ejection`/`deploy`; several deploys pair in order), `kpis` (`apogee_m`, `apogee_t`, `vmax_ms`, `amax_ms2`, `landing_t`: sim, real, sim minus real, percent of real), `rmse` of the three series over the common `window`, `site_distance_m`, and `warnings` with stable codes (`site_far` beyond 1 km, `pad_unknown`, `single_deploy` when one simulated parachute meets a real ejection + deploy, `sim_approximate`, `no_overlap`, `real_ends_early`, `missing_<series>`). `to_dict()` for JSON. |

> Sensitivity and scenario-comparison use-cases are planned (issues
> [#3](https://github.com/Multitec-UA/icaroRS/issues/3),
> [#4](https://github.com/Multitec-UA/icaroRS/issues/4)); `compare_scenarios`
> stays reserved for the latter. Comparing a simulation with a real flight is
> `compare_with_real_flight` above.

## Example

```python
from icaro import simulate_from_export

flight = simulate_from_export("Serializer-export-rockets/v1.5.0")
flight.info()   # presentation is the caller's job
```
