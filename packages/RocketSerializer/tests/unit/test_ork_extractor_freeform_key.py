"""Unit tests for ork_extractor freeform_fins wiring.

JVM-free — patches all I/O and JVM-bound calls. Asserts that the
settings dict returned by ork_extractor always contains the 'freeform_fins' key
regardless of whether any freeform fins are present in the .ork file.
"""

from unittest.mock import MagicMock, patch

import pytest
from bs4 import BeautifulSoup

# ---------------------------------------------------------------------------
# Minimal XML stubs — realistic enough for __init_vectors and the element
# searches to execute without error, but trivially small.
# ---------------------------------------------------------------------------

_MINIMAL_XML = """\
<?xml version="1.0" encoding="utf-8"?>
<openrocket version="1.7" creator="OpenRocket 15.03">
  <rocket>
    <subcomponents>
      <stage>
        <subcomponents>
          <nosecone>
            <name>Nosecone</name>
          </nosecone>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
  <simulations>
    <simulation>
      <flightdata>
        <databranch types="Time,Altitude,Velocity">
          <datapoint>0.0,0.0,0.0</datapoint>
          <datapoint>1.0,100.0,50.0</datapoint>
        </databranch>
      </flightdata>
    </simulation>
  </simulations>
</openrocket>
"""


def _make_bs():
    return BeautifulSoup(_MINIMAL_XML, "xml")


# ---------------------------------------------------------------------------
# Helper: patch every I/O call inside ork_extractor so we never touch disk
# or the JVM.  Each search_* function returns a minimal valid dict or list.
# ---------------------------------------------------------------------------

_PATCH_BASE = "rocketserializer.ork_extractor"


def _build_patches(freeform_return_value):
    """Return the list of patch targets and their return values."""
    return [
        (f"{_PATCH_BASE}.search_motor", {"dry_mass": 0.1, "position": 0}),
        (f"{_PATCH_BASE}.__get_motor_mass", (0.1, 0.1, 0.0)),
        (f"{_PATCH_BASE}.search_id_info", {}),
        (f"{_PATCH_BASE}.search_environment", {}),
        (
            f"{_PATCH_BASE}.search_rocket",
            (
                {
                    "radius": 0.05,
                    "mass": 1.0,
                    "center_of_mass_without_propellant": 0.5,
                    "drag_curve": "drag.csv",
                },
                0.0,
            ),
        ),
        (f"{_PATCH_BASE}.search_launch_conditions", {}),
        (f"{_PATCH_BASE}.process_elements_position", {}),
        (f"{_PATCH_BASE}.search_nosecone", {}),
        (f"{_PATCH_BASE}.search_trapezoidal_fins", {}),
        (f"{_PATCH_BASE}.search_elliptical_fins", {}),
        (f"{_PATCH_BASE}.search_free_form_fins", freeform_return_value),
        (f"{_PATCH_BASE}.search_transitions", {}),
        (f"{_PATCH_BASE}.search_rail_buttons", {}),
        (f"{_PATCH_BASE}.search_parachutes", {}),
        (
            f"{_PATCH_BASE}.search_stored_results",
            {
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
        ),
        (f"{_PATCH_BASE}.save_drag_curve", "drag.csv"),
        (f"{_PATCH_BASE}.generate_thrust_curve", "thrust.csv"),
    ]


def _run_extractor(freeform_return_value):
    """Patch every dependency and call ork_extractor, returning settings."""
    from rocketserializer.ork_extractor import ork_extractor  # noqa: PLC0415

    bs = _make_bs()
    ork = MagicMock()

    patches = _build_patches(freeform_return_value)
    with patch(
        f"{_PATCH_BASE}._NotebookBuilder__get_motor_mass",
        return_value=(0.1, 0.1, 0.0),
        create=True,
    ):
        # Apply all patches via nested context managers built dynamically
        active = [patch(target, return_value=rv) for target, rv in patches]
        for p in active:
            p.start()
        try:
            result = ork_extractor(
                bs=bs,
                filepath="fake.ork",
                output_folder="/tmp/fake_output",
                ork=ork,
            )
        finally:
            for p in active:
                p.stop()
    return result


# ---------------------------------------------------------------------------
# Task 2.4 tests
# ---------------------------------------------------------------------------


def test_freeform_fins_key_present_when_empty():
    """'freeform_fins' key MUST be present in settings even when extractor returns {}."""
    result = _run_extractor(freeform_return_value={})
    assert "freeform_fins" in result, (
        "settings dict is missing 'freeform_fins' key when no freeform fins exist"
    )
    assert isinstance(result["freeform_fins"], dict)
    assert result["freeform_fins"] == {}


def test_freeform_fins_key_present_when_populated():
    """'freeform_fins' key MUST be present and populated when extractor returns data."""
    freeform_data = {
        0: {
            "name": "TestFin",
            "number": 4,
            "cant_angle": 0.0,
            "position": 0.5,
            "shape_points": [[0.0, 0.0], [0.025, 0.05], [0.05, 0.0]],
        }
    }
    result = _run_extractor(freeform_return_value=freeform_data)
    assert "freeform_fins" in result, (
        "settings dict is missing 'freeform_fins' key when freeform fins exist"
    )
    assert isinstance(result["freeform_fins"], dict)
    assert len(result["freeform_fins"]) == 1
