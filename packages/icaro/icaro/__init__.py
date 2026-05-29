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

Phase C (Monte Carlo) — forward stub, implemented in Phase C:
    run_monte_carlo

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
from .scenario import Scenario, load_scenario
from .simulation import simulate_from_export

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
    # Phase C — added when montecarlo.py is implemented
    # "run_monte_carlo",
    # Phase D — added when sensitivity.py is implemented
    # "run_sensitivity",
    # Phase E — added when comparison.py is implemented
    # "compare_scenarios",
]
