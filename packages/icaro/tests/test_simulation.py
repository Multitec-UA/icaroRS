"""Tests for icaro.simulation — build_environment, simulate_from_export.

All tests are pure unit tests that monkeypatch rocketpy internals.
No network connections, JVM, or real export files are needed.

The monkeypatch pattern follows the sys.modules approach established in
commit a4e7c4b (patch ork_extractor module via sys.modules to bypass
__init__ rebind).

Coverage targets:
- REQ-SIM-02: scenario-driven atmosphere selection
- REQ-SIM-03: forecast fallback control flow + warning emitted
- REQ-XC-04: warning must identify model + failure + fallback
- REQ-XC-05: simulate_from_export(export_dir) backward compat (no scenario)
- SIM-3: standard_atmosphere fallback path
- A3 test plan: four cases documented in tasks artifact.
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

# These will fail until simulation.py exports build_environment (RED phase).
from icaro.simulation import build_environment, simulate_from_export
from icaro.scenario import (
    Atmosphere,
    LaunchDate,
    Rail,
    Scenario,
    Site,
    load_scenario,
)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _make_scenario(
    model: str = "standard_atmosphere",
    file: str | None = None,
    fallback: str = "standard_atmosphere",
    date: LaunchDate | None = None,
    elevation: float | None = 120.0,
    rail: Rail | None = None,
) -> Scenario:
    """Build a minimal Scenario without going through YAML parsing."""
    return Scenario(
        name="test",
        site=Site(latitude=38.37, longitude=-0.58, elevation=elevation),
        date=date,
        atmosphere=Atmosphere(model=model, file=file, fallback=fallback),
        rail=rail,
    )


def _make_env_data() -> dict:
    return {"latitude": 38.37, "longitude": -0.58, "elevation": 120.0}


def _minimal_params() -> dict:
    """A parameters.json with every key build_nominal_flight needs, and no more."""
    return {
        "environment": {"latitude": 38.37, "longitude": -0.58, "elevation": 120.0},
        "motors": {
            "dry_mass": 1.0,
            "dry_inertia": [0.01, 0.01, 0.005],
            "nozzle_radius": 0.03,
            "grain_number": 4,
            "grain_density": 1800.0,
            "grain_outer_radius": 0.02,
            "grain_initial_inner_radius": 0.01,
            "grain_initial_height": 0.05,
            "grain_separation": 0.001,
            "grains_center_of_mass_position": 0.1,
            "center_of_dry_mass_position": 0.1,
            "nozzle_position": -0.1,
            "throat_radius": 0.01,
            "coordinate_system_orientation": "nozzle_to_combustion_chamber",
            "position": -0.5,
        },
        "rocket": {
            "radius": 0.05,
            "mass": 5.0,
            "inertia": [0.1, 0.1, 0.02],
            "center_of_mass_without_propellant": 0.4,
            "coordinate_system_orientation": "tail_to_nose",
        },
        "nosecones": {
            "length": 0.4,
            "kind": "ogive",
            "position": 1.0,
            "name": "Nose",
            "base_radius": 0.05,
        },
        "flight": {"rail_length": 5.0, "inclination": 84.0, "heading": 90.0},
        "tails": {},
        "trapezoidal_fins": {},
        "elliptical_fins": {},
        "freeform_fins": {},
        "parachutes": {},
    }


def _write_export(tmp_path: Path, params: dict) -> Path:
    """Write params plus the two CSVs build_nominal_flight reads off disk."""
    export_dir = tmp_path / "export"
    export_dir.mkdir()
    (export_dir / "parameters.json").write_text(json.dumps(params))
    (export_dir / "thrust_source.csv").write_text(
        "0.0,0.0\n0.1,100.0\n1.0,50.0\n2.0,0.0\n"
    )
    (export_dir / "drag_curve.csv").write_text("0.0,0.3\n0.5,0.4\n1.0,0.5\n")
    return export_dir


# ---------------------------------------------------------------------------
# A3 — standard_atmosphere path (no network)
# ---------------------------------------------------------------------------


def test_build_environment_standard_atmosphere(monkeypatch):
    """standard_atmosphere path: set_atmospheric_model called with correct type; no warnings."""
    mock_env = MagicMock()
    mock_env_cls = MagicMock(return_value=mock_env)

    monkeypatch.setattr("icaro.simulation.Environment", mock_env_cls)

    scenario = _make_scenario(model="standard_atmosphere")
    env_data = _make_env_data()

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = build_environment(env_data, scenario)

    mock_env.set_atmospheric_model.assert_called_once_with(type="standard_atmosphere")
    # No atmosphere-fallback warnings should fire.
    fallback_warnings = [
        w for w in caught if "falling back" in str(w.message).lower()
    ]
    assert fallback_warnings == [], "Unexpected fallback warning on standard_atmosphere path"
    assert result is mock_env


# ---------------------------------------------------------------------------
# A3 — forecast fallback path: first call raises, falls back + warns
# ---------------------------------------------------------------------------


def test_build_environment_forecast_fallback_on_error(monkeypatch):
    """forecast path: if set_atmospheric_model raises, falls back to standard_atmosphere AND warns."""
    mock_env = MagicMock()
    mock_env_cls = MagicMock(return_value=mock_env)

    # First call (forecast) raises; second call (standard_atmosphere) succeeds.
    mock_env.set_atmospheric_model.side_effect = [
        RuntimeError("THREDDS connection refused"),
        None,
    ]

    monkeypatch.setattr("icaro.simulation.Environment", mock_env_cls)

    scenario = _make_scenario(
        model="forecast",
        file="GFS",
        fallback="standard_atmosphere",
        date=LaunchDate(year=2025, month=6, day=15, hour=12),
    )
    env_data = _make_env_data()

    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        result = build_environment(env_data, scenario)

    # Must NOT crash.
    assert result is mock_env

    # Fallback set_atmospheric_model must be called.
    calls = mock_env.set_atmospheric_model.call_args_list
    assert len(calls) == 2
    assert calls[0] == call(type="forecast", file="GFS")
    assert calls[1] == call(type="standard_atmosphere")

    # Warning must be emitted (REQ-XC-04).
    assert len(caught) >= 1, "Expected at least one UserWarning about fallback"
    warning_text = " ".join(str(w.message) for w in caught).lower()
    assert "forecast" in warning_text or "gfs" in warning_text
    assert "standard_atmosphere" in warning_text


# ---------------------------------------------------------------------------
# A3 — scenario=None path: backward compat uses standard_atmosphere
# ---------------------------------------------------------------------------


def test_build_environment_no_scenario_uses_standard_atmosphere(monkeypatch):
    """scenario=None → standard_atmosphere used (backward compat REQ-XC-05)."""
    mock_env = MagicMock()
    mock_env_cls = MagicMock(return_value=mock_env)

    monkeypatch.setattr("icaro.simulation.Environment", mock_env_cls)

    env_data = _make_env_data()
    result = build_environment(env_data, scenario=None)

    mock_env.set_atmospheric_model.assert_called_once_with(type="standard_atmosphere")
    assert result is mock_env


# ---------------------------------------------------------------------------
# A3 — Elevation fallback: scenario with site.elevation=None uses export value
# ---------------------------------------------------------------------------


def test_build_environment_elevation_fallback_from_export(monkeypatch):
    """When scenario.site.elevation is None, the export env_data elevation is used."""
    mock_env = MagicMock()
    mock_env_cls = MagicMock(return_value=mock_env)

    monkeypatch.setattr("icaro.simulation.Environment", mock_env_cls)

    scenario = _make_scenario(elevation=None)  # No elevation in scenario
    env_data = {"latitude": 38.37, "longitude": -0.58, "elevation": 99.0}

    build_environment(env_data, scenario)

    # Environment constructor must receive elevation=99.0 from export.
    _, kwargs = mock_env_cls.call_args
    assert kwargs.get("elevation") == pytest.approx(99.0) or mock_env_cls.call_args[0][0] == pytest.approx(99.0)


# ---------------------------------------------------------------------------
# A4 — build_nominal_flight: scenario rail override applied
# ---------------------------------------------------------------------------


def test_build_nominal_flight_rail_override(tmp_path, monkeypatch):
    """Passing a scenario with rail.inclination overrides the export value (REQ-SIM-04)."""
    # Create a minimal export directory.
    params = {
        "environment": {"latitude": 38.37, "longitude": -0.58, "elevation": 120.0},
        "motors": {
            "dry_mass": 1.0,
            "dry_inertia": [0.01, 0.01, 0.005],
            "nozzle_radius": 0.03,
            "grain_number": 4,
            "grain_density": 1800.0,
            "grain_outer_radius": 0.02,
            "grain_initial_inner_radius": 0.01,
            "grain_initial_height": 0.05,
            "grain_separation": 0.001,
            "grains_center_of_mass_position": 0.1,
            "center_of_dry_mass_position": 0.1,
            "nozzle_position": -0.1,
            "throat_radius": 0.01,
            "coordinate_system_orientation": "nozzle_to_combustion_chamber",
            "position": -0.5,
        },
        "rocket": {
            "radius": 0.05,
            "mass": 5.0,
            "inertia": [0.1, 0.1, 0.02],
            "center_of_mass_without_propellant": 0.4,
            "coordinate_system_orientation": "tail_to_nose",
        },
        "nosecones": {
            "length": 0.4,
            "kind": "ogive",
            "position": 1.0,
            "name": "Nose",
            "base_radius": 0.05,
        },
        "flight": {
            "rail_length": 5.0,
            "inclination": 84.0,  # export value
            "heading": 90.0,
        },
        "tails": {},
        "trapezoidal_fins": {},
        "elliptical_fins": {},
        "freeform_fins": {},
        "parachutes": {},
    }
    export_dir = tmp_path / "export"
    export_dir.mkdir()
    (export_dir / "parameters.json").write_text(json.dumps(params))
    # Write a minimal thrust CSV.
    (export_dir / "thrust_source.csv").write_text(
        "0.0,0.0\n0.1,100.0\n1.0,50.0\n2.0,0.0\n"
    )
    # Write a minimal drag curve.
    (export_dir / "drag_curve.csv").write_text("0.0,0.3\n0.5,0.4\n1.0,0.5\n")

    from icaro.simulation import build_nominal_flight

    # Monkeypatch the entire rocketpy layer so we don't actually simulate.
    mock_env = MagicMock()
    mock_motor = MagicMock()
    mock_rocket = MagicMock()
    mock_flight = MagicMock()

    with (
        patch("icaro.simulation.Environment", return_value=mock_env),
        patch("icaro.simulation.SolidMotor", return_value=mock_motor),
        patch("icaro.simulation.Rocket", return_value=mock_rocket),
        patch("icaro.simulation.Flight", return_value=mock_flight) as mock_flight_cls,
    ):
        mock_env.set_atmospheric_model = MagicMock()

        scenario = _make_scenario(
            model="standard_atmosphere",
            rail=Rail(inclination=80.0),  # override: 80 not 84
        )

        result_flight, result_rocket, result_motor, result_env, result_params = (
            build_nominal_flight(export_dir, scenario)
        )

    # Assert Flight was constructed with the SCENARIO inclination (80), not export (84).
    _, flight_kwargs = mock_flight_cls.call_args
    assert flight_kwargs["inclination"] == pytest.approx(80.0)


# ---------------------------------------------------------------------------
# A5 — simulate_from_export backward compat: no scenario still works
# ---------------------------------------------------------------------------


def test_simulate_from_export_backward_compat_no_scenario(tmp_path, monkeypatch):
    """REQ-XC-05: simulate_from_export(export_dir) without scenario kwarg still works."""
    # We just verify the public signature accepts no scenario and routes through
    # standard_atmosphere. We don't run a real sim.
    params = {
        "environment": {"latitude": 38.37, "longitude": -0.58, "elevation": 120.0},
        "motors": {
            "dry_mass": 1.0,
            "dry_inertia": [0.01, 0.01, 0.005],
            "nozzle_radius": 0.03,
            "grain_number": 4,
            "grain_density": 1800.0,
            "grain_outer_radius": 0.02,
            "grain_initial_inner_radius": 0.01,
            "grain_initial_height": 0.05,
            "grain_separation": 0.001,
            "grains_center_of_mass_position": 0.1,
            "center_of_dry_mass_position": 0.1,
            "nozzle_position": -0.1,
            "throat_radius": 0.01,
            "coordinate_system_orientation": "nozzle_to_combustion_chamber",
            "position": -0.5,
        },
        "rocket": {
            "radius": 0.05,
            "mass": 5.0,
            "inertia": [0.1, 0.1, 0.02],
            "center_of_mass_without_propellant": 0.4,
            "coordinate_system_orientation": "tail_to_nose",
        },
        "nosecones": {
            "length": 0.4,
            "kind": "ogive",
            "position": 1.0,
            "name": "Nose",
            "base_radius": 0.05,
        },
        "flight": {
            "rail_length": 5.0,
            "inclination": 84.0,
            "heading": 90.0,
        },
        "tails": {},
        "trapezoidal_fins": {},
        "elliptical_fins": {},
        "freeform_fins": {},
        "parachutes": {},
    }
    export_dir = tmp_path / "export"
    export_dir.mkdir()
    (export_dir / "parameters.json").write_text(json.dumps(params))
    (export_dir / "thrust_source.csv").write_text(
        "0.0,0.0\n0.1,100.0\n1.0,50.0\n2.0,0.0\n"
    )
    (export_dir / "drag_curve.csv").write_text("0.0,0.3\n0.5,0.4\n1.0,0.5\n")

    mock_env = MagicMock()
    mock_motor = MagicMock()
    mock_rocket = MagicMock()
    mock_flight = MagicMock()

    with (
        patch("icaro.simulation.Environment", return_value=mock_env),
        patch("icaro.simulation.SolidMotor", return_value=mock_motor),
        patch("icaro.simulation.Rocket", return_value=mock_rocket),
        patch("icaro.simulation.Flight", return_value=mock_flight) as mock_flight_cls,
    ):
        mock_env.set_atmospheric_model = MagicMock()

        result = simulate_from_export(export_dir)  # no scenario kwarg

    assert result is mock_flight
    # Verify standard_atmosphere was used.
    mock_env.set_atmospheric_model.assert_called_once_with(type="standard_atmosphere")


def test_simulate_from_export_with_scenario_routes_through_build_environment(
    tmp_path, monkeypatch
):
    """simulate_from_export(export_dir, scenario=...) passes scenario to build_environment."""
    params = {
        "environment": {"latitude": 38.37, "longitude": -0.58, "elevation": 120.0},
        "motors": {
            "dry_mass": 1.0,
            "dry_inertia": [0.01, 0.01, 0.005],
            "nozzle_radius": 0.03,
            "grain_number": 4,
            "grain_density": 1800.0,
            "grain_outer_radius": 0.02,
            "grain_initial_inner_radius": 0.01,
            "grain_initial_height": 0.05,
            "grain_separation": 0.001,
            "grains_center_of_mass_position": 0.1,
            "center_of_dry_mass_position": 0.1,
            "nozzle_position": -0.1,
            "throat_radius": 0.01,
            "coordinate_system_orientation": "nozzle_to_combustion_chamber",
            "position": -0.5,
        },
        "rocket": {
            "radius": 0.05,
            "mass": 5.0,
            "inertia": [0.1, 0.1, 0.02],
            "center_of_mass_without_propellant": 0.4,
            "coordinate_system_orientation": "tail_to_nose",
        },
        "nosecones": {
            "length": 0.4,
            "kind": "ogive",
            "position": 1.0,
            "name": "Nose",
            "base_radius": 0.05,
        },
        "flight": {
            "rail_length": 5.0,
            "inclination": 84.0,
            "heading": 90.0,
        },
        "tails": {},
        "trapezoidal_fins": {},
        "elliptical_fins": {},
        "freeform_fins": {},
        "parachutes": {},
    }
    export_dir = tmp_path / "export"
    export_dir.mkdir()
    (export_dir / "parameters.json").write_text(json.dumps(params))
    (export_dir / "thrust_source.csv").write_text(
        "0.0,0.0\n0.1,100.0\n1.0,50.0\n2.0,0.0\n"
    )
    (export_dir / "drag_curve.csv").write_text("0.0,0.3\n0.5,0.4\n1.0,0.5\n")

    mock_env = MagicMock()
    mock_motor = MagicMock()
    mock_rocket = MagicMock()
    mock_flight = MagicMock()

    with (
        patch("icaro.simulation.Environment", return_value=mock_env),
        patch("icaro.simulation.SolidMotor", return_value=mock_motor),
        patch("icaro.simulation.Rocket", return_value=mock_rocket),
        patch("icaro.simulation.Flight", return_value=mock_flight),
    ):
        mock_env.set_atmospheric_model = MagicMock()

        scenario = _make_scenario(model="standard_atmosphere")
        result = simulate_from_export(export_dir, scenario=scenario)

    assert result is mock_flight


# ---------------------------------------------------------------------------
# deploy_trigger — OpenRocket deploy_event → RocketPy Parachute trigger
#
# OpenRocket describes WHEN the ejection charge fires; RocketPy wants the
# trigger itself. It accepts only a callable, a number, or the exact string
# "apogee" (see rocketpy/rocket/parachute.py __evaluate_trigger_function).
# Passing the raw export string through crashed simulate on every export whose
# parachute was not set to "apogee".
# ---------------------------------------------------------------------------


def _chute(deploy_event, deploy_altitude=None, deploy_delay=0.0):
    """Build a parachute entry as RocketSerializer writes it to parameters.json."""
    return {
        "name": "Paracaídas",
        "cd": 0.8,
        "cds": 1.5,
        "area": 1.875,
        "deploy_event": deploy_event,
        "deploy_delay": deploy_delay,
        "deploy_altitude": deploy_altitude,
    }


def test_deploy_trigger_apogee_returns_rocketpy_apogee_string():
    """An "apogee" event maps to RocketPy's own apogee detector."""
    from icaro.simulation import deploy_trigger

    assert deploy_trigger(_chute("apogee")) == "apogee"


def test_deploy_trigger_altitude_returns_deploy_altitude_as_float():
    """An "altitude" event maps to the height, which RocketPy reads as a number."""
    from icaro.simulation import deploy_trigger

    trigger = deploy_trigger(_chute("altitude", deploy_altitude=200.0))

    assert isinstance(trigger, float)
    assert trigger == pytest.approx(200.0)


def test_deploy_trigger_launch_returns_always_true_callable():
    """A "launch" event fires the signal immediately; `lag` models the delay."""
    from icaro.simulation import deploy_trigger

    trigger = deploy_trigger(_chute("launch", deploy_delay=14.0))

    assert callable(trigger)
    # Still on the rail, climbing: the signal has already fired.
    assert trigger(101325.0, 0.0, [0, 0, 0, 0, 0, 120.0, 1, 0, 0, 0, 0, 0, 0]) is True


def test_deploy_trigger_launch_is_accepted_by_rocketpy_parachute():
    """Guard the real contract: RocketPy must accept what we hand it.

    A unit test asserting `callable(...)` would still pass if RocketPy tightened
    its trigger signature, so build an actual Parachute here.
    """
    from rocketpy.rocket.parachute import Parachute

    from icaro.simulation import deploy_trigger

    chute = _chute("launch", deploy_delay=14.0)
    parachute = Parachute(
        name=chute["name"],
        cd_s=chute["cds"],
        trigger=deploy_trigger(chute),
        sampling_rate=100,
        lag=chute["deploy_delay"],
    )

    assert parachute.triggerfunc(101325.0, 0.0, [0] * 13, None) is True


def test_deploy_trigger_unknown_event_raises_value_error():
    """An unrecognised event must fail loudly, naming the offending value."""
    from icaro.simulation import deploy_trigger

    with pytest.raises(ValueError, match="lower_stage_separation"):
        deploy_trigger(_chute("lower_stage_separation"))


def test_deploy_trigger_altitude_without_height_raises_value_error():
    """An "altitude" event with no height is a malformed export, not a crash."""
    from icaro.simulation import deploy_trigger

    with pytest.raises(ValueError, match="deploy_altitude"):
        deploy_trigger(_chute("altitude", deploy_altitude=None))


def test_build_rocket_translates_launch_event_before_calling_rocketpy(tmp_path):
    """Regression: a "launch" parachute used to reach RocketPy raw and 500.

    Reproduces the MT1-v1.6.0 export (Paracaídas, "Deploys at Launch plus 14s").
    """
    params = _minimal_params()
    params["parachutes"] = {"0": _chute("launch", deploy_delay=14.0)}
    export_dir = _write_export(tmp_path, params)

    from icaro.simulation import build_nominal_flight

    mock_rocket = MagicMock()

    with (
        patch("icaro.simulation.Environment", return_value=MagicMock()),
        patch("icaro.simulation.SolidMotor", return_value=MagicMock()),
        patch("icaro.simulation.Rocket", return_value=mock_rocket),
        patch("icaro.simulation.Flight", return_value=MagicMock()),
    ):
        build_nominal_flight(export_dir, _make_scenario(model="standard_atmosphere"))

    _, kwargs = mock_rocket.add_parachute.call_args
    assert callable(kwargs["trigger"]), "raw 'launch' string must not reach RocketPy"
    # The 14s delay belongs to `lag`, not to the trigger.
    assert kwargs["lag"] == pytest.approx(14.0)


def test_build_rocket_translates_altitude_event_before_calling_rocketpy(tmp_path):
    """An "altitude" parachute must arrive as its height, not the word."""
    params = _minimal_params()
    params["parachutes"] = {"0": _chute("altitude", deploy_altitude=200.0)}
    export_dir = _write_export(tmp_path, params)

    from icaro.simulation import build_nominal_flight

    mock_rocket = MagicMock()

    with (
        patch("icaro.simulation.Environment", return_value=MagicMock()),
        patch("icaro.simulation.SolidMotor", return_value=MagicMock()),
        patch("icaro.simulation.Rocket", return_value=mock_rocket),
        patch("icaro.simulation.Flight", return_value=MagicMock()),
    ):
        build_nominal_flight(export_dir, _make_scenario(model="standard_atmosphere"))

    _, kwargs = mock_rocket.add_parachute.call_args
    assert kwargs["trigger"] == pytest.approx(200.0)
