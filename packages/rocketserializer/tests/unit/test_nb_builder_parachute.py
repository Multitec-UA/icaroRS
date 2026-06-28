"""Unit tests for NotebookBuilder parachute deployment codegen.

JVM-free — instantiates NotebookBuilder with a minimal in-memory parameters dict
by patching the file open so no real .json file is required.

Covers the deployment trigger mapping in build_parachute():
  - apogee   -> trigger='apogee'
  - altitude -> trigger=<float height>
  - launch   -> trigger=lambda (fires at launch) + lag from deploy_delay
  - OpenRocket deploy_delay -> rocketpy lag (previously ignored)
  - unknown deploy_event still raises ValueError
"""

import copy
import json
from unittest.mock import mock_open, patch

import nbformat as nbf
import pytest

from rocketserializer.nb_builder import NotebookBuilder

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
    "nosecones": {"length": 0.3, "kind": "ogive", "position": 1.2},
    "trapezoidal_fins": {},
    "elliptical_fins": {},
    "freeform_fins": {},
    "tails": {},
    "parachutes": {},
    "rail_buttons": {},
    "motors": {},
    "flight": {"rail_length": 5.0, "inclination": 85.0, "heading": 0.0},
    "stored_results": {},
}


def _make_params(parachutes):
    params = copy.deepcopy(_MINIMAL_PARAMS)
    params["parachutes"] = parachutes
    return params


def _make_builder(params: dict) -> NotebookBuilder:
    json_str = json.dumps(params)
    m = mock_open(read_data=json_str)
    with patch("builtins.open", m):
        builder = NotebookBuilder("fake_params.json")
    return builder


def _chute(deploy_event, deploy_delay=0.0, deploy_altitude=None):
    return {
        "name": "Main",
        "cd": 1.0,
        "cds": 1.13,
        "area": 1.13,
        "deploy_event": deploy_event,
        "deploy_delay": deploy_delay,
        "deploy_altitude": deploy_altitude,
    }


def _parachute_source(builder) -> str:
    nb = nbf.v4.new_notebook()
    nb["cells"] = []
    builder.build_parachute(nb)
    return "\n".join(
        cell["source"] for cell in nb["cells"] if cell["cell_type"] == "code"
    )


def test_apogee_emits_string_trigger():
    builder = _make_builder(_make_params({"0": _chute("apogee")}))
    source = _parachute_source(builder)
    assert "trigger='apogee'" in source
    # No delay -> no lag kwarg
    assert "lag=" not in source


def test_altitude_emits_float_trigger():
    builder = _make_builder(
        _make_params({"0": _chute("altitude", deploy_altitude=200.0)})
    )
    source = _parachute_source(builder)
    assert "trigger=200.000" in source


def test_launch_emits_lambda_trigger_with_lag():
    """'Deploys at Launch plus N seconds' must not crash and must map the
    delay to rocketpy's lag with a launch-time trigger."""
    builder = _make_builder(_make_params({"0": _chute("launch", deploy_delay=14.0)}))
    source = _parachute_source(builder)
    assert "trigger=lambda p, h, y: True" in source
    assert "lag=14.000" in source


def test_deploy_delay_maps_to_lag_for_apogee():
    """deploy_delay was previously parsed but ignored; it must now become lag."""
    builder = _make_builder(_make_params({"0": _chute("apogee", deploy_delay=1.73)}))
    source = _parachute_source(builder)
    assert "lag=1.730" in source


def test_unknown_deploy_event_raises():
    builder = _make_builder(_make_params({"0": _chute("never")}))
    with pytest.raises(ValueError):
        _parachute_source(builder)
