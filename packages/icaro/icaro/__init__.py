"""icaroRS domain layer.

Pure use-cases that orchestrate the core libraries (rocketpy, and later
rocketserializer) into meaningful operations. No I/O presentation lives here —
delivery mechanisms (CLI, API, web) call into this package and decide how to
show the results.

Public API
----------
Phase A (simulation + scenario):
    simulate_from_export  — deterministic 6-DOF flight from an export dir
    load_scenario         — load and validate a scenario YAML
    Scenario              — scenario dataclass (for type hints)

Phase B (convert):
    convert_ork           — convert a .ork file to an export directory
    ConvertUnavailableError — raised when [convert] extra / Java is missing

Phase C (Monte Carlo, issue #2):
    run_monte_carlo       — stochastic dispersion run → MonteCarloResult
    build_stochastic      — RocketPy stochastic models from export + budget
    MonteCarloResult      — apogee distribution, impacts, ellipses, files

Launch day (SURT x SpainRocketry L1):
    recommend_rail        — sweep rail inclination/heading → RailSweep
    evaluate_rail         — one rail setting → RailCandidate
    launch_checks         — L1 go/no-go checklist → list[LaunchCheck]
    LaunchLimits          — L1 limits (defaults from the competition guide)
    Wind                  — manual pad wind for a Scenario

Stability:
    wind_stability_margin — rail-exit margin with body lift (OpenRocket-equivalent)
    WindMarginResult      — static and with-wind margins, AoA, CPs

Real flight interop (contract mt-interop schema v1):
    interop_simulation_payload     - Flight → site, events, stats, series
    interop_simulation_from_series - approximate payload from stored chart data
    compare_with_real_flight       - simulated vs real flight → FlightComparison
    FlightComparison               - aligned series, event/KPI deltas, RMSE, warnings
    InteropSchemaError             - an interop document has the wrong schema

Phase D (Sensitivity) — forward stub, implemented in Phase D:
    run_sensitivity

Phase E (Comparison) — forward stub, implemented in Phase E:
    compare_scenarios

Note on lazy imports
--------------------
``convert_ork`` lives in ``icaro.convert`` and uses a **lazy import** for
rocketserializer / orhelper.  Importing ``icaro`` (this module) does NOT
trigger those imports — they only fire when ``convert_ork`` is called.
"""

from .convert import ConvertUnavailableError, convert_ork
from .discovery import choose_atmosphere_model_for_date, gfs_window_check
from .launchday import (
    LaunchCheck,
    LaunchLimits,
    RailCandidate,
    RailSweep,
    evaluate_rail,
    launch_checks,
    recommend_rail,
)
from .montecarlo import MonteCarloResult, build_stochastic, run_monte_carlo
from .scenario import Scenario, Wind, load_scenario
from .series import extract_flight_series
from .simulation import simulate_from_export
from .interop import (
    INTEROP_REAL_FLIGHT_SCHEMA,
    INTEROP_SIMULATION_SCHEMA,
    FlightComparison,
    InteropSchemaError,
    compare_with_real_flight,
    interop_simulation_from_series,
    interop_simulation_payload,
)
from .stability import WindMarginResult, wind_stability_margin

__all__ = [
    # Phase A
    "simulate_from_export",
    "load_scenario",
    "Scenario",
    # Phase B
    "convert_ork",
    "ConvertUnavailableError",
    # Phase 1 web helpers
    "gfs_window_check",
    "choose_atmosphere_model_for_date",
    # Issue #11 — interactive charts data layer
    "extract_flight_series",
    # Phase C — Monte Carlo dispersion (issue #2)
    "run_monte_carlo",
    "build_stochastic",
    "MonteCarloResult",
    # Launch day (L1)
    "recommend_rail",
    "evaluate_rail",
    "launch_checks",
    "LaunchLimits",
    "RailSweep",
    "RailCandidate",
    "LaunchCheck",
    "Wind",
    # Stability (rail-exit margin with wind)
    "wind_stability_margin",
    "WindMarginResult",
    # Real flight interop (mt-interop schema v1)
    "interop_simulation_payload",
    "interop_simulation_from_series",
    "compare_with_real_flight",
    "FlightComparison",
    "InteropSchemaError",
    "INTEROP_SIMULATION_SCHEMA",
    "INTEROP_REAL_FLIGHT_SCHEMA",
    # Phase D — added when sensitivity.py is implemented
    # "run_sensitivity",
    # Phase E — added when comparison.py is implemented
    # "compare_scenarios",
]
