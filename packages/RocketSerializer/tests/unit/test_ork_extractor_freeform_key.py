"""Unit tests for ork_extractor freeform_fins wiring.

JVM-free — patches all I/O and JVM-bound calls. Asserts that the
settings dict returned by ork_extractor always contains the 'freeform_fins' key
regardless of whether any freeform fins are present in the .ork file.
"""

import sys
from unittest.mock import MagicMock, patch

from bs4 import BeautifulSoup

# Force-import the submodule, then retrieve it from sys.modules — `import as`
# and `getattr(package, name)` would both return the FUNCTION because the
# package `__init__.py` does `from .ork_extractor import ork_extractor`,
# rebinding the package-level attribute from the module to the function.
import rocketserializer.ork_extractor  # noqa: F401
_ork_module = sys.modules["rocketserializer.ork_extractor"]

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


# Patching is done via `patch.object` against the actual module reference
# (`_ork_module`) rather than the dotted string `rocketserializer.ork_extractor.X`.
# Reason: the package `__init__.py` does `from .ork_extractor import ork_extractor`,
# which rebinds `rocketserializer.ork_extractor` (the package attribute) from the
# module to the FUNCTION. `mock.patch("rocketserializer.ork_extractor.X")` would
# then resolve `ork_extractor` to the function and fail with AttributeError on `X`.


def _build_patches(freeform_return_value):
    """Return the list of (attribute_name, return_value) pairs to patch on the module."""
    return [
        ("search_motor", {"dry_mass": 0.1, "position": 0}),
        ("search_id_info", {}),
        ("search_environment", {}),
        (
            "search_rocket",
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
        ("search_launch_conditions", {}),
        ("process_elements_position", {}),
        ("search_nosecone", {}),
        ("search_trapezoidal_fins", {}),
        ("search_elliptical_fins", {}),
        ("search_free_form_fins", freeform_return_value),
        ("search_transitions", {}),
        ("search_rail_buttons", {}),
        ("search_parachutes", {}),
        (
            "search_stored_results",
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
        ("save_drag_curve", "drag.csv"),
        ("generate_thrust_curve", "thrust.csv"),
    ]


def _run_extractor(freeform_return_value):
    """Patch every dependency and call ork_extractor, returning settings."""
    from rocketserializer.ork_extractor import ork_extractor  # noqa: PLC0415

    bs = _make_bs()
    ork = MagicMock()

    patches = _build_patches(freeform_return_value)
    active = [
        patch.object(_ork_module, name, return_value=rv) for name, rv in patches
    ]
    # __get_motor_mass uses leading dunder (module-level, no name mangling at import
    # time but `patch.object` still resolves it via getattr — passes through fine).
    active.append(
        patch.object(
            _ork_module,
            "__get_motor_mass",
            return_value=(0.1, 0.1, 0.0),
            create=True,
        )
    )
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
