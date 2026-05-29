"""Flight serialization adapter — apps/api presentation surface.

Converts a ``rocketpy.Flight`` object into a JSON-serializable dict by:

1. Extracting scalar attributes (each guarded by ``getattr`` + try/except so a
   missing attribute is silently omitted — never crashes).
2. Rendering plot PNGs via ``flight.plots.*`` methods that accept
   ``filename=`` (all methods except ``pressure_signals`` and ``all``).
3. Writing all outputs (PNGs + ``result.json``) into ``{run_dir}/{run_id}/``.
4. Stringifying any captured ``warnings.WarningMessage`` objects.

Architecture note (RG-5.3 / ADR-0)
------------------------------------
This adapter lives in ``apps/api``, NOT in ``packages/icaro``.  A package
returns a Flight; it does not print it.  The plotting and JSON-rendering are
presentation concerns owned by the delivery surface.

Plot filename= support
----------------------
All ``_FlightPlots`` methods that accept ``filename=`` (confirmed by reading
``packages/rocketpy/rocketpy/plots/flight_plots.py`` + ``plot_helpers.py``):

  trajectory_3d, linear_kinematics_data, attitude_data, flight_path_angle_data,
  angular_kinematics_data, aerodynamic_forces, energy_data, fluid_mechanics_data,
  stability_and_control_data, pressure_rocket_altitude,
  rail_buttons_bending_moments, rail_buttons_forces

NOT supported (no filename= param, excluded from render list):
  pressure_signals — only accepts ``self``
  all              — only accepts ``self``, generates all plots + calls plt.show()

Usage
-----
>>> from icaro_api.serialize import serialize_flight
>>> result = serialize_flight(flight, run_dir=Path("/tmp/runs"), run_id="abc", captured_warnings=[])
>>> result.keys()  # {run_id, scalars, plot_urls, warnings}
"""

from __future__ import annotations

import json
import warnings as _warnings_module
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Scalar label + unit map (presentation layer — never on the domain side).
#
# Maps internal Flight attribute names → (output_key, label, unit).
# The output_key is what appears in the JSON; label + unit are for the UI's
# _SCALAR_LABEL_MAP (used by the results template).
# ---------------------------------------------------------------------------

_SCALAR_ATTR_MAP: list[tuple[str, str, str, str]] = [
    # (flight_attr, output_key, human_label, unit)
    ("apogee", "apogee_m", "Highest point (apogee)", "m"),
    ("apogee_time", "apogee_time_s", "Time to apogee", "s"),
    ("apogee_x", "apogee_x_m", "Apogee — East displacement", "m"),
    ("apogee_y", "apogee_y_m", "Apogee — North displacement", "m"),
    ("t_final", "flight_time_s", "Total flight time", "s"),
    ("x_impact", "impact_x_m", "Impact — East displacement", "m"),
    ("y_impact", "impact_y_m", "Impact — North displacement", "m"),
    ("impact_velocity", "impact_velocity_ms", "Impact velocity", "m/s"),
    ("max_speed", "max_velocity_ms", "Maximum speed", "m/s"),
    ("max_speed_time", "max_velocity_time_s", "Time of maximum speed", "s"),
    ("max_mach_number", "max_mach", "Maximum Mach number", ""),
    ("max_acceleration", "max_acceleration_ms2", "Maximum acceleration", "m/s²"),
    ("max_acceleration_time", "max_acceleration_time_s", "Time of max acceleration", "s"),
    ("out_of_rail_velocity", "rail_departure_velocity_ms", "Rail departure velocity", "m/s"),
    ("out_of_rail_time", "rail_departure_time_s", "Rail departure time", "s"),
    ("out_of_rail_stability_margin", "rail_departure_stability_margin", "Rail departure stability margin", "cal"),
]

# Static label map for template/UI use (key → {label, unit}).
_SCALAR_LABEL_MAP: dict[str, dict[str, str]] = {
    output_key: {"label": label, "unit": unit}
    for (_, output_key, label, unit) in _SCALAR_ATTR_MAP
}

# ---------------------------------------------------------------------------
# Plot render manifest — methods that accept filename= (keyword-only).
# Order: start with the most useful plots for a launch review.
# ---------------------------------------------------------------------------

_PLOT_METHODS: list[tuple[str, str]] = [
    # (method_name, output_filename_stem)
    ("trajectory_3d", "trajectory_3d"),
    ("linear_kinematics_data", "linear_kinematics"),
    ("flight_path_angle_data", "flight_path_angle"),
    ("energy_data", "energy"),
    ("aerodynamic_forces", "aerodynamic_forces"),
    ("stability_and_control_data", "stability_control"),
    ("angular_kinematics_data", "angular_kinematics"),
    ("attitude_data", "attitude"),
    ("fluid_mechanics_data", "fluid_mechanics"),
    ("pressure_rocket_altitude", "pressure_altitude"),
    ("rail_buttons_bending_moments", "rail_bending_moments"),
    ("rail_buttons_forces", "rail_forces"),
    # pressure_signals and all are EXCLUDED (no filename= support).
]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def serialize_flight(
    flight: Any,
    run_dir: Path,
    run_id: str,
    captured_warnings: list[Any],
) -> dict[str, Any]:
    """Serialize a ``rocketpy.Flight`` into a JSON-safe dict.

    Parameters
    ----------
    flight : rocketpy.Flight (or stub in tests)
        The completed flight object returned by ``simulate_from_export``.
    run_dir : Path
        Base results directory.  A sub-directory ``{run_id}/`` is created
        (or reused if it already exists).
    run_id : str
        Unique identifier for this run (from ``make_run_id()``).
    captured_warnings : list
        List of ``warnings.WarningMessage`` objects captured during simulation.
        Each is stringified and included in the ``warnings`` output key.

    Returns
    -------
    dict
        ``{run_id, scalars, plot_urls, warnings}``

        * ``scalars``: flat dict of float values (missing attrs omitted).
        * ``plot_urls``: list of relative URL strings
          ``/api/results/{run_id}/plots/{name}.png``.
        * ``warnings``: list of plain-language warning strings.
    """
    output_dir = run_dir / run_id
    output_dir.mkdir(parents=True, exist_ok=True)

    scalars = _extract_scalars(flight)
    plot_urls = _render_plots(flight, output_dir, run_id)
    warning_strings = _stringify_warnings(captured_warnings)

    result: dict[str, Any] = {
        "run_id": run_id,
        "scalars": scalars,
        "plot_urls": plot_urls,
        "warnings": warning_strings,
    }

    # Persist result.json for re-serve and forward-compat async/MC (RG-9.7).
    (output_dir / "result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2)
    )

    return result


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _extract_scalars(flight: Any) -> dict[str, Any]:
    """Extract scalar attributes from *flight* into a flat JSON-safe dict.

    Each attribute is guarded by ``getattr`` with a sentinel; an additional
    try/except catches any unexpected error during attribute access (e.g. a
    computed property that raises).  Missing attrs → key omitted silently.
    """
    _MISSING = object()
    scalars: dict[str, Any] = {}

    for flight_attr, output_key, _label, _unit in _SCALAR_ATTR_MAP:
        try:
            value = getattr(flight, flight_attr, _MISSING)
            if value is _MISSING:
                continue
            # Convert to float to ensure JSON-serializability
            # (rocketpy may return numpy scalars in some configs).
            scalars[output_key] = float(value)
        except Exception:  # noqa: BLE001
            # Any error extracting a scalar → silently omit the key.
            continue

    return scalars


def _render_plots(flight: Any, output_dir: Path, run_id: str) -> list[str]:
    """Render all supported plots to PNG and return their relative URLs.

    Skips a plot method silently if it does not exist on the flight object
    (forward-compat with different rocketpy configs / stubs in tests).
    """
    plots_obj = getattr(flight, "plots", None)
    if plots_obj is None:
        return []

    urls: list[str] = []

    for method_name, stem in _PLOT_METHODS:
        method = getattr(plots_obj, method_name, None)
        if method is None:
            continue
        filename = output_dir / f"{stem}.png"
        try:
            method(filename=str(filename))
        except Exception:  # noqa: BLE001
            # A plot method failing must not crash the whole serialization.
            continue
        # Some rocketpy plot methods print a skip notice and return WITHOUT
        # writing a file or raising — e.g. rail_buttons_bending_moments when
        # the rail button height is undefined. Only advertise the URL if the
        # PNG was actually written, so the UI never shows a broken image.
        if filename.exists() and filename.stat().st_size > 0:
            urls.append(f"/api/results/{run_id}/plots/{stem}.png")

    return urls


def _stringify_warnings(
    captured: list[Any],
) -> list[str]:
    """Convert ``warnings.WarningMessage`` objects to plain strings.

    Extracts ``str(w.message)`` which gives the human-readable warning text
    (e.g. "GFS forecast unavailable; using standard atmosphere").
    """
    result: list[str] = []
    for w in captured:
        try:
            msg = str(w.message)
            if msg:
                result.append(msg)
        except Exception:  # noqa: BLE001
            continue
    return result
