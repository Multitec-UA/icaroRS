"""Unit tests for NotebookBuilder freeform fins codegen.

JVM-free — instantiates NotebookBuilder with a minimal in-memory parameters dict
by patching the file open so no real .json file is required.

Covers:
  3.1 / 3.2 — freeform_fins_check initialised to False
  3.3 / 3.4 — build_imports emits FreeFormFins in the import string
  3.5 / 3.6 — build_fins emits FreeFormFins cells when populated, skips when empty
  3.8 / 3.9 — add_surfaces_to_rocket includes freeform_fins[i] when check is True
"""

import json
from io import StringIO
from unittest.mock import MagicMock, mock_open, patch

import nbformat as nbf
import pytest

from rocketserializer.nb_builder import NotebookBuilder

# ---------------------------------------------------------------------------
# Minimal parameters dict shared across tests
# ---------------------------------------------------------------------------

_MINIMAL_PARAMS = {
    "id": {},
    "environment": {"latitude": 0.0, "longitude": 0.0, "elevation": 0.0},
    "rocket": {
        "radius": 0.05,
        "mass": 5.0,
        "inertia": [0.1, 0.1, 0.02],
        "center_of_mass_without_propellant": 0.5,
        "drag_curve": "/tmp/drag.csv",
        "coordinate_system_orientation": "tail_to_nose",
    },
    "nosecones": {
        "length": 0.3,
        "kind": "ogive",
        "position": 1.2,
    },
    "trapezoidal_fins": {},
    "elliptical_fins": {},
    "freeform_fins": {},
    "tails": {},
    "parachutes": {},
    "rail_buttons": {},
    "motors": {
        "thrust_source": "/tmp/thrust.csv",
        "dry_mass": 0.1,
        "center_of_dry_mass_position": 0.0,
        "dry_inertia": [0.01, 0.01, 0.001],
        "grains_center_of_mass_position": 0.0,
        "grain_number": 1,
        "grain_density": 1800.0,
        "grain_outer_radius": 0.02,
        "grain_initial_inner_radius": 0.01,
        "grain_initial_height": 0.1,
        "grain_separation": 0.0,
        "nozzle_radius": 0.01,
        "nozzle_position": -0.1,
        "throat_radius": 0.005,
        "coordinate_system_orientation": "nozzle_to_combustion_chamber",
        "position": -0.5,
    },
    "flight": {
        "rail_length": 5.0,
        "inclination": 85.0,
        "heading": 0.0,
    },
    "stored_results": {
        "time_to_apogee": 10.0,
        "flight_time": 30.0,
        "ground_hit_velocity": -5.0,
        "launch_rod_velocity": 20.0,
        "max_acceleration": 50.0,
        "max_altitude": 1000.0,
        "max_mach": 0.5,
        "max_velocity": 170.0,
        "max_thrust": 200.0,
        "burnout_stability_margin": 2.0,
        "max_stability_margin": 3.0,
        "min_stability_margin": 1.0,
    },
}

_FREEFORM_ENTRY = {
    "name": "FinSet",
    "number": 4,
    "cant_angle": 0.0,
    "position": 0.8,
    "shape_points": [
        [0.0, 0.0],
        [-0.025, 0.05],
        [-0.075, 0.05],
        [-0.05, 0.0],
    ],
}


def _make_params(freeform_fins=None):
    """Return a deep copy of _MINIMAL_PARAMS with optional freeform_fins override."""
    import copy

    params = copy.deepcopy(_MINIMAL_PARAMS)
    if freeform_fins is not None:
        params["freeform_fins"] = freeform_fins
    return params


def _make_builder(params: dict) -> NotebookBuilder:
    """Instantiate NotebookBuilder with an in-memory params dict (no real file)."""
    json_str = json.dumps(params)
    m = mock_open(read_data=json_str)
    with patch("builtins.open", m):
        builder = NotebookBuilder("fake_params.json")
    return builder


# ---------------------------------------------------------------------------
# Task 3.1 / 3.2 — freeform_fins_check initialised to False
# ---------------------------------------------------------------------------


def test_freeform_fins_check_false_by_default():
    """NbBuilder must initialise freeform_fins_check to False."""
    builder = _make_builder(_make_params())
    assert hasattr(builder, "freeform_fins_check"), (
        "NotebookBuilder must have a 'freeform_fins_check' attribute"
    )
    assert builder.freeform_fins_check is False, (
        "freeform_fins_check must default to False"
    )


# ---------------------------------------------------------------------------
# Task 3.3 / 3.4 — build_imports includes FreeFormFins
# ---------------------------------------------------------------------------


def test_build_imports_includes_freeformfins():
    """build_imports() must emit 'FreeFormFins' in the rocketpy import cell."""
    builder = _make_builder(_make_params())
    nb = nbf.v4.new_notebook()
    nb["cells"] = []
    nb = builder.build_imports(nb)

    all_source = "\n".join(
        cell["source"] for cell in nb["cells"] if cell["cell_type"] == "code"
    )
    assert "FreeFormFins" in all_source, (
        f"'FreeFormFins' not found in import cell source.\nGot: {all_source!r}"
    )


# ---------------------------------------------------------------------------
# Task 3.5 — build_fins with empty freeform_fins emits nothing freeform
# ---------------------------------------------------------------------------


def test_build_fins_no_freeform_no_cell():
    """build_fins() must NOT emit any FreeFormFins cell when freeform_fins is empty."""
    builder = _make_builder(_make_params(freeform_fins={}))
    nb = nbf.v4.new_notebook()
    nb["cells"] = []
    nb = builder.build_fins(nb)

    all_source = "\n".join(
        cell["source"] for cell in nb["cells"] if cell["cell_type"] == "code"
    )
    assert "FreeFormFins" not in all_source, (
        "build_fins() must NOT emit FreeFormFins when freeform_fins is empty"
    )
    assert builder.freeform_fins_check is False, (
        "freeform_fins_check must remain False when freeform_fins is empty"
    )


# ---------------------------------------------------------------------------
# Task 3.6 — build_fins with populated freeform_fins emits correct cells
# ---------------------------------------------------------------------------


def test_build_fins_with_freeform_emits_cells():
    """build_fins() must emit FreeFormFins(...) cells and set freeform_fins_check."""
    params = _make_params(freeform_fins={"0": _FREEFORM_ENTRY})
    builder = _make_builder(params)
    nb = nbf.v4.new_notebook()
    nb["cells"] = []
    nb = builder.build_fins(nb)

    all_source = "\n".join(
        cell["source"] for cell in nb["cells"] if cell["cell_type"] == "code"
    )
    assert "FreeFormFins(" in all_source, (
        "build_fins() must emit a FreeFormFins(...) call when freeform_fins is non-empty"
    )
    assert "n=" in all_source
    assert "shape_points=" in all_source
    assert builder.freeform_fins_check is True, (
        "freeform_fins_check must be True after build_fins() with freeform fins"
    )


# ---------------------------------------------------------------------------
# Task 3.8 / 3.9 — add_surfaces_to_rocket includes freeform_fins[i]
# ---------------------------------------------------------------------------


def test_add_surfaces_freeform():
    """add_surfaces_to_rocket() must include freeform_fins[0] when check is True."""
    params = _make_params(freeform_fins={"0": _FREEFORM_ENTRY})
    builder = _make_builder(params)
    # Simulate build_fins having run already
    builder.freeform_fins_check = True

    nb = nbf.v4.new_notebook()
    nb["cells"] = []
    nb = builder.add_surfaces_to_rocket(nb)

    all_source = "\n".join(
        cell["source"] for cell in nb["cells"] if cell["cell_type"] == "code"
    )
    assert "freeform_fins[0]" in all_source, (
        f"'freeform_fins[0]' not found in add_surfaces cell.\nGot: {all_source!r}"
    )
