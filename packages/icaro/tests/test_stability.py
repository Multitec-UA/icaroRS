"""Tests for the rail-exit stability margin with body lift (wind margin).

Unit tests use stub flights/rockets so they run without solving a flight.
The integration test simulates the MT1-v1.7.1 export against OpenRocket's
stored rail-exit numbers (4.54 cal with a 2 m/s wind).
"""

from __future__ import annotations

import math
import os
import warnings
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from icaro.stability import (
    BODY_LIFT_K,
    WindMarginResult,
    body_planform,
    wind_stability_margin,
)

# ---------------------------------------------------------------------------
# Stubs
# ---------------------------------------------------------------------------


def _surface(clalpha: float, cpz: float, radius: float):
    return SimpleNamespace(clalpha=lambda mach: clalpha, cpz=cpz, rocket_radius=radius)


def _stub(alpha_deg: float, static_margin: float = 2.5):
    """Two surfaces (CNa 2 at z=0.1, CNa 10 at z=1.0), nose_to_tail, r=0.05.

    Static CP = (2*0.1 + 10*1.0) / 12 = 0.85 m; CG 0.6 m -> 2.5 cal.
    """
    radius = 0.05
    rocket = SimpleNamespace(
        radius=radius,
        _csys=-1,
        aerodynamic_surfaces=[
            # position.z - csys*cpz = 0.1 and 1.0
            (_surface(2.0, 0.0, radius), SimpleNamespace(z=0.1)),
            (_surface(10.0, 0.0, radius), SimpleNamespace(z=1.0)),
        ],
    )
    flight = SimpleNamespace(
        rocket=rocket,
        out_of_rail_time=0.3,
        out_of_rail_stability_margin=static_margin,
        mach_number=lambda t: 0.05,
        angle_of_attack=lambda t: alpha_deg,
    )
    return flight, rocket


def _tube_params(**extra):
    params = {
        "rocket": {"radius": 0.05, "coordinate_system_orientation": "nose_to_tail"},
        "nosecones": {
            "kind": "conical",
            "length": 0.2,
            "base_radius": 0.05,
            "position": 0.0,
            "name": "Nose",
        },
        "body_segments": [
            {
                "kind": "bodytube",
                "name": "Tube",
                "position": 0.0,
                "length": 1.0,
                "fore_radius": 0.05,
                "aft_radius": 0.05,
            }
        ],
    }
    params.update(extra)
    return params


# ---------------------------------------------------------------------------
# Planform
# ---------------------------------------------------------------------------


def test_trapezoid_planform_for_a_transition():
    params = _tube_params()
    params["body_segments"] = [
        {
            "kind": "transition",
            "name": "Boattail",
            "position": 0.5,
            "length": 0.1,
            "fore_radius": 0.04,
            "aft_radius": 0.02,
        }
    ]
    segments, used_fallback = body_planform(params)
    assert used_fallback is False
    (area, centroid), = segments
    assert area == pytest.approx(0.1 * (0.04 + 0.02))
    assert centroid == pytest.approx(0.5 + 0.1 * (0.04 + 2 * 0.02) / (3 * 0.06))


def test_ellipsoid_nose_planform_matches_numeric_integration():
    length, radius = 0.18, 0.03
    params = _tube_params()
    params["nosecones"].update(kind="ellipsoid", length=length, base_radius=radius)
    params["body_segments"] = [
        {
            "kind": "nosecone",
            "name": "Nose",
            "position": 0.0,
            "length": length,
            "fore_radius": 0.0,
            "aft_radius": radius,
        }
    ]
    (area, centroid), = body_planform(params)[0]

    x = np.linspace(0.0, length, 2_000_001)
    width = 2 * radius * np.sqrt(np.clip(1 - (1 - x / length) ** 2, 0, None))
    num_area = np.trapezoid(width, x)
    num_centroid = np.trapezoid(width * x, x) / num_area
    assert area == pytest.approx(num_area, abs=1e-6)
    assert centroid == pytest.approx(num_centroid, abs=1e-6)


def test_fallback_without_body_segments_is_flagged_and_warned():
    params = _tube_params(
        trapezoidal_fins={"0": {"position": 0.9, "root_chord": 0.15}},
        motors={
            "position": 1.0,
            "nozzle_position": -0.05,
            "coordinate_system_orientation": "nozzle_to_combustion_chamber",
        },
    )
    del params["body_segments"]
    with pytest.warns(UserWarning, match="body_segments"):
        segments, used_fallback = body_planform(params)
    assert used_fallback is True
    nose, tube = segments
    # Conical nose: exact triangle.
    assert nose == pytest.approx((0.2 * 0.05, 0.2 * 2 / 3))
    # Tube from the nose base (0.2) to the aft-most of fin trailing edge
    # (1.05) and nozzle (1.0 + 0.05 = 1.05) -> 0.85 m long.
    assert tube == pytest.approx((0.85 * 0.1, 0.2 + 0.85 / 2))


# ---------------------------------------------------------------------------
# Wind margin
# ---------------------------------------------------------------------------


def test_zero_angle_of_attack_equals_static_margin_exactly():
    flight, rocket = _stub(alpha_deg=0.0, static_margin=2.4999999999999)
    result = wind_stability_margin(flight, rocket, _tube_params())
    assert isinstance(result, WindMarginResult)
    assert result.wind_cal == result.static_cal == 2.4999999999999
    assert result.cp_wind == result.cp_static
    assert result.angle_of_attack_deg == 0.0


def test_synthetic_case_with_known_numbers():
    flight, rocket = _stub(alpha_deg=math.degrees(0.1))
    result = wind_stability_margin(flight, rocket, _tube_params())

    weight = BODY_LIFT_K * 0.1 / (math.pi * 0.05**2) * math.sin(0.1) ** 2 / 0.1
    cp_wind = (2 * 0.1 + 10 * 1.0 + weight * 0.5) / (12 + weight)
    assert result.cp_static == pytest.approx(0.85)
    assert result.cp_wind == pytest.approx(cp_wind)
    assert result.static_cal == 2.5
    assert result.wind_cal == pytest.approx((cp_wind - 0.6) / 0.1)
    assert result.angle_of_attack_deg == pytest.approx(math.degrees(0.1))
    assert result.used_fallback is False


# ---------------------------------------------------------------------------
# Integration — MT1-v1.7.1 vs OpenRocket (4.54 cal at rail exit)
# ---------------------------------------------------------------------------

_V171 = Path(__file__).resolve().parents[3] / "Serializer-export-rockets" / "v1.7.1"


@pytest.mark.integration
@pytest.mark.skipif(not (_V171 / "parameters.json").exists(), reason="no v1.7.1 export")
def test_mt1_v171_matches_openrocket_rail_exit_margin():
    from icaro.scenario import (
        Atmosphere,
        Rail,
        Scenario,
        Site,
        Wind,
    )
    from icaro.simulation import build_nominal_flight

    def run(wind_speed):
        # OpenRocket conditions: 2 m/s from 90 deg (pi/2 rad), rod 3 deg
        # from vertical toward 90 deg, launch into the wind.
        scenario = Scenario(
            name="v171",
            site=Site(latitude=41.729922, longitude=0.104161, elevation=233.0),
            atmosphere=Atmosphere(model="standard_atmosphere"),
            rail=Rail(length=2.5, inclination=87.0, heading=90.0),
            wind=Wind(speed=wind_speed, direction_from=90.0),
        )
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            flight, rocket, _, _, params = build_nominal_flight(_V171, scenario)
            return wind_stability_margin(flight, rocket, params)

    calm = run(0.0)
    assert calm.wind_cal == calm.static_cal
    assert calm.static_cal == pytest.approx(5.79, abs=0.05)

    windy = run(2.0)
    print(
        f"\nMT1-v1.7.1 rail exit: static {windy.static_cal:.3f} cal, "
        f"wind {windy.wind_cal:.3f} cal, AoA {windy.angle_of_attack_deg:.3f} deg "
        f"({math.radians(windy.angle_of_attack_deg):.4f} rad), "
        f"CP static {windy.cp_static:.4f} m, CP wind {windy.cp_wind:.4f} m, "
        f"fallback {windy.used_fallback}"
    )
    assert windy.wind_cal == pytest.approx(4.54, abs=0.2)


def test_rail_exit_wind_margin_never_fails_the_simulation():
    from icaro.simulation import rail_exit_wind_margin

    flight = SimpleNamespace(out_of_rail_time=None)  # no mach_number etc.
    with pytest.warns(UserWarning, match="could not be computed"):
        assert rail_exit_wind_margin(flight, SimpleNamespace(), {}) is None
