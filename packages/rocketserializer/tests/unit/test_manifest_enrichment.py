"""Unit tests for the manifest enrichment: reference simulation, motor identity
and provenance (odd/tasks/manifest-enrichment.md, S1-S3).

JVM-free: every test works on BeautifulSoup trees built from inline XML or on
the already-unzipped example ``rocket.ork`` files.
"""

import json
import sys
from pathlib import Path

import numpy as np
import pytest
from bs4 import BeautifulSoup

import rocketserializer.ork_extractor  # noqa: F401
from rocketserializer.components.id import search_id_info
from rocketserializer.components.motor import build_thrust_curve, search_motor
from rocketserializer.components.motor_identity import (
    burn_time_seconds,
    check_impulse,
    parse_impulse_class,
    search_motor_identity,
)
from rocketserializer.components.stored_results import search_stored_results

# The package __init__ rebinds `rocketserializer.ork_extractor` to the function;
# fetch the module itself (see test_ork_extractor_freeform_key.py).
_ork_module = sys.modules["rocketserializer.ork_extractor"]
select_reference_simulation = _ork_module.select_reference_simulation
init_vectors = getattr(_ork_module, "__init_vectors")

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
EXAMPLES = PACKAGE_ROOT / "examples"

DEFAULT_ID = "cfg-default"
OTHER_ID = "cfg-other"

LABELS = "Time,Altitude,Thrust,Propellant mass,Stability margin calibers"


def _motor(config_id, designation, manufacturer="Cesaroni Technology", kind="reload"):
    return (
        f'<motor configid="{config_id}"><type>{kind}</type>'
        f"<manufacturer>{manufacturer}</manufacturer>"
        f"<designation>{designation}</designation>"
        "<diameter>0.038</diameter><length>0.186</length><delay>9.0</delay></motor>"
    )


def _simulation(name, status, config_id, points=None, events=""):
    if points is None:
        points = ["0,0,0,0.1,1", "1,10,100,0.05,2", "2,20,0,0,3"]
    status_attr = f' status="{status}"' if status is not None else ""
    datapoints = "".join(f"<datapoint>{p}</datapoint>" for p in points)
    return (
        f"<simulation{status_attr}><name>{name}</name>"
        f"<conditions><configid>{config_id}</configid></conditions>"
        f'<flightdata maxaltitude="{len(name) * 100}">'
        f'<databranch name="Main" types="{LABELS}">{events}{datapoints}</databranch>'
        "</flightdata></simulation>"
    )


def _document(simulations, motors=None, default_id=DEFAULT_ID, header=None):
    if motors is None:
        motors = _motor(DEFAULT_ID, "232H123-14A") + _motor(OTHER_ID, "J350W", "AeroTech")
    header = header or '<openrocket version="1.10" creator="OpenRocket 24.12">'
    return BeautifulSoup(
        '<?xml version="1.0" encoding="utf-8"?>'
        f"{header}<rocket><name>R</name>"
        f'<motorconfiguration configid="{OTHER_ID}"/>'
        f'<motorconfiguration configid="{default_id}" default="true"/>'
        f"<subcomponents><motormount>{motors}</motormount></subcomponents>"
        f"</rocket><simulations>{''.join(simulations)}</simulations></openrocket>",
        "xml",
    )


def _name(sim):
    return sim.find("name").text


# --- S1: reference simulation -------------------------------------------------


def test_uptodate_default_beats_uptodate_other():
    bs = _document(
        [
            _simulation("other", "uptodate", OTHER_ID),
            _simulation("default", "uptodate", DEFAULT_ID),
        ]
    )
    sim, selection = select_reference_simulation(bs)
    assert (_name(sim), selection) == ("default", "uptodate_default")


def test_uptodate_other_beats_loaded_and_outdated():
    bs = _document(
        [
            _simulation("old", "outdated", DEFAULT_ID),
            _simulation("loaded", "loaded", DEFAULT_ID),
            _simulation("fresh", "uptodate", OTHER_ID),
        ]
    )
    sim, selection = select_reference_simulation(bs)
    assert (_name(sim), selection) == ("fresh", "uptodate_other")


def test_loaded_default_beats_loaded_other_and_outdated():
    bs = _document(
        [
            _simulation("old", "outdated", DEFAULT_ID),
            _simulation("lo", "loaded", OTHER_ID),
            _simulation("ld", "loaded", DEFAULT_ID),
        ]
    )
    sim, selection = select_reference_simulation(bs)
    assert (_name(sim), selection) == ("ld", "loaded_default")


def test_loaded_other_beats_outdated():
    bs = _document(
        [
            _simulation("old", "outdated", DEFAULT_ID),
            _simulation("lo", "loaded", OTHER_ID),
        ]
    )
    sim, selection = select_reference_simulation(bs)
    assert (_name(sim), selection) == ("lo", "loaded_other")


def test_fallback_is_first_remaining_simulation():
    bs = _document(
        [
            _simulation("first", "outdated", OTHER_ID),
            _simulation("second", None, DEFAULT_ID),
        ]
    )
    sim, selection = select_reference_simulation(bs)
    assert (_name(sim), selection) == ("first", "fallback")


def test_simulations_without_datapoints_are_skipped():
    bs = _document(
        [
            _simulation("empty", "uptodate", DEFAULT_ID, points=[]),
            _simulation("old", "outdated", OTHER_ID),
        ]
    )
    sim, selection = select_reference_simulation(bs)
    assert (_name(sim), selection) == ("old", "fallback")


def test_no_eligible_simulation_returns_none():
    bs = _document([_simulation("empty", "uptodate", DEFAULT_ID, points=[])])
    assert select_reference_simulation(bs) == (None, None)
    assert select_reference_simulation(_document([])) == (None, None)


def test_series_come_from_the_reference_simulation_only():
    bs = _document(
        [
            _simulation("ref", "uptodate", DEFAULT_ID),
            _simulation(
                "later", "outdated", OTHER_ID, points=["0,0,5,1,1", "9,9,5,0,1", "10,9,0,0,1"]
            ),
        ]
    )
    sim, _ = select_reference_simulation(bs)
    datapoints, labels, time_vector = init_vectors(bs, sim)
    assert labels == LABELS.split(",")
    # Today's trimming: from the last t == 0 sample up to (excluding) the last one.
    assert time_vector == [0.0, 1.0]
    assert [d.text for d in datapoints] == ["0,0,0,0.1,1", "1,10,100,0.05,2"]


def test_single_simulation_series_match_legacy_whole_document_read():
    bs = _document([_simulation("only", "outdated", DEFAULT_ID)])
    sim, _ = select_reference_simulation(bs)
    datapoints, labels, time_vector = init_vectors(bs, sim)
    legacy = init_vectors(bs)
    assert [d.text for d in datapoints] == [d.text for d in legacy[0]]
    assert (labels, time_vector) == (legacy[1], legacy[2])


# --- S2: motor identity -------------------------------------------------------


@pytest.mark.parametrize(
    "designation, expected",
    [
        ("232H123-14A", "H"),
        ("J350W", "J"),
        ("K828FJ", "K"),
        ("H123W", "H"),
        ("O25000", "O"),
        ("Pro38 6GXL", None),
        ("", None),
        (None, None),
    ],
)
def test_impulse_class_is_parsed_from_the_designation(designation, expected):
    assert parse_impulse_class(designation) == expected


def test_trapezoid_impulse_is_checked_against_the_class_range():
    curve = np.array([[0.0, 0.0], [1.0, 200.0], [2.0, 200.0], [3.0, 0.0]])
    # trapezoid: 100 + 200 + 100 = 400 N*s -> class I (320.01-640)
    assert check_impulse(curve, "I") == (pytest.approx(400.0, rel=1e-9), "ok")
    assert check_impulse(curve, "H") == (None, "class_mismatch")
    assert check_impulse(curve, None) == (pytest.approx(400.0, rel=1e-9), "unchecked")
    assert check_impulse(np.empty((0, 2)), "H") == (None, "unchecked")
    assert check_impulse(None, None) == (None, "unchecked")


def test_build_thrust_curve_matches_the_written_csv(tmp_path):
    from rocketserializer.components.motor import generate_thrust_curve

    bs = _document([_simulation("only", "uptodate", DEFAULT_ID)])
    sim, _ = select_reference_simulation(bs)
    datapoints, labels, time_vector = init_vectors(bs, sim)
    path = generate_thrust_curve(str(tmp_path), datapoints, labels, time_vector)
    written = np.loadtxt(path, delimiter=",", ndmin=2)
    np.testing.assert_allclose(
        build_thrust_curve(datapoints, labels, time_vector), written, rtol=1e-6
    )


def test_burn_time_from_events():
    events = (
        '<event time="0.5" type="ignition"/><event time="0.6" type="liftoff"/>'
        '<event time="2.25" type="burnout"/>'
    )
    bs = _document([_simulation("s", "uptodate", DEFAULT_ID, events=events)])
    sim, _ = select_reference_simulation(bs)
    assert burn_time_seconds(sim, None) == pytest.approx(1.75)


def test_burn_time_from_thrust_threshold_when_no_events():
    bs = _document([_simulation("s", "uptodate", DEFAULT_ID)])
    sim, _ = select_reference_simulation(bs)
    curve = np.array([[0.0, 0.5], [0.1, 10.0], [1.0, 100.0], [2.0, 2.0], [3.0, 0.5]])
    # threshold = 1 N: above it from t=0.1 to t=2.0
    assert burn_time_seconds(sim, curve) == pytest.approx(1.9)
    assert burn_time_seconds(sim, None) is None
    assert burn_time_seconds(None, np.empty((0, 2))) is None


def test_identity_describes_the_motor_of_the_reference_configuration():
    bs = _document(
        [
            _simulation("d", "outdated", DEFAULT_ID),
            _simulation("o", "uptodate", OTHER_ID),
        ]
    )
    sim, _ = select_reference_simulation(bs)
    # 150 + 600 + 150 = 900 N*s (class J); above 1 % of peak from 0.5 s to 1.5 s
    curve = np.array([[0.0, 0.0], [0.5, 600.0], [1.5, 600.0], [2.0, 0.0]])
    identity = search_motor_identity(bs, sim, curve)
    assert identity == {
        "designation": "J350W",
        "manufacturer": "AeroTech",
        "ork_motor_type": "reload",
        "config_id": OTHER_ID,
        "motor_count": 1,
        "impulse_class": "J",
        "total_impulse_newton_seconds": pytest.approx(900.0),
        "impulse_check": "ok",
        "burn_time_seconds": pytest.approx(1.0),
    }


def test_identity_falls_back_to_default_then_first_motor():
    only_default = _motor(DEFAULT_ID, "232H123-14A")
    bs = _document([_simulation("o", "uptodate", OTHER_ID)], motors=only_default)
    sim, _ = select_reference_simulation(bs)
    assert search_motor_identity(bs, sim, None)["config_id"] == DEFAULT_ID

    stray = _motor("cfg-stray", "H123W", "AeroTech")
    bs = _document([_simulation("o", "uptodate", OTHER_ID)], motors=stray)
    sim, _ = select_reference_simulation(bs)
    identity = search_motor_identity(bs, sim, None)
    assert identity["config_id"] == "cfg-stray"
    assert identity["designation"] == "H123W"


def test_identity_counts_motors_and_uses_null_for_missing_values():
    motors = _motor(DEFAULT_ID, "Pro38") + _motor(DEFAULT_ID, "Pro38")
    bs = _document([_simulation("d", "uptodate", DEFAULT_ID)], motors=motors)
    sim, _ = select_reference_simulation(bs)
    identity = search_motor_identity(bs, sim, np.empty((0, 2)))
    assert identity["motor_count"] == 2
    assert identity["impulse_class"] is None
    assert identity["total_impulse_newton_seconds"] is None
    assert identity["impulse_check"] == "unchecked"
    assert identity["burn_time_seconds"] is None


def test_identity_is_null_without_motor():
    bs = _document([_simulation("d", "uptodate", DEFAULT_ID)], motors="")
    sim, _ = select_reference_simulation(bs)
    assert search_motor_identity(bs, sim, None) is None


# --- S3: provenance -----------------------------------------------------------


def test_stored_results_carry_provenance_and_keep_numeric_keys():
    bs = _document(
        [
            _simulation("old", "outdated", DEFAULT_ID),
            _simulation("fresh", "uptodate", OTHER_ID),
        ]
    )
    sim, selection = select_reference_simulation(bs)
    datapoints, labels, time_vector = init_vectors(bs, sim)
    results = search_stored_results(
        bs, datapoints, labels, time_vector, np.int64(1), sim, selection
    )
    assert results["simulation_name"] == "fresh"
    assert results["status"] == "uptodate"
    assert results["config_id"] == OTHER_ID
    assert results["selection"] == "uptodate_other"
    assert results["max_altitude"] == 500.0  # from the reference simulation
    assert results["max_velocity"] == 0  # legacy "0 when missing"


def test_id_carries_format_version_creator_and_serializer_version():
    from importlib.metadata import version

    bs = _document([_simulation("d", "uptodate", DEFAULT_ID)])
    info = search_id_info(bs, "examples/x/rocket.ork")
    assert info["ork_format_version"] == "1.10"
    assert info["creator"] == "OpenRocket 24.12"
    assert info["serializer_version"] == version("rocketserializer")


def test_id_provenance_is_null_when_absent():
    bs = _document(
        [_simulation("d", "uptodate", DEFAULT_ID)], header="<openrocket>"
    )
    info = search_id_info(bs, "x.ork")
    assert info["ork_format_version"] is None
    assert info["creator"] is None


# --- Value-level regressions on real files ------------------------------------


def _load(path):
    return BeautifulSoup(path.read_text(encoding="utf-8"), features="xml")


def _reference_manifest_parts(path):
    from rocketserializer.components.motor import __get_motor_mass  # noqa: PLC0415

    bs = _load(path)
    sim, selection = select_reference_simulation(bs)
    datapoints, labels, time_vector = init_vectors(bs, sim)
    _, _, burnout = __get_motor_mass(datapoints, labels)
    stored = search_stored_results(
        bs, datapoints, labels, time_vector, burnout, sim, selection
    )
    curve = build_thrust_curve(datapoints, labels, time_vector)
    identity = search_motor_identity(bs, sim, curve)
    return bs, sim, datapoints, labels, stored, identity


def test_mt1_v140_reference_is_the_uptodate_simulation():
    bs, sim, _, _, stored, identity = _reference_manifest_parts(
        EXAMPLES / "MT1--2026" / "v1.4.0" / "rocket.ork"
    )
    uptodate = [s for s in bs.find_all("simulation") if s.get("status") == "uptodate"]
    assert len(uptodate) == 1
    expected_altitude = float(uptodate[0].find("flightdata")["maxaltitude"])

    assert stored["simulation_name"] == uptodate[0].find("name").text
    assert stored["status"] == "uptodate"
    assert stored["selection"] == "uptodate_default"
    assert stored["max_altitude"] == pytest.approx(expected_altitude, rel=1e-6)
    assert stored["max_altitude"] == pytest.approx(882.746, rel=1e-6)
    assert identity["config_id"] == stored["config_id"]
    assert identity["designation"] == "261H120-14A"
    assert identity["impulse_class"] == "H"


@pytest.mark.parametrize(
    "example",
    ["EPFL--BellaLui--2020", "ProjetoJupiter--Valetudo--2019"],
)
def test_single_simulation_examples_keep_their_physics_keys(example):
    _, _, datapoints, labels, stored, identity = _reference_manifest_parts(
        EXAMPLES / example / "rocket.ork"
    )
    committed = json.loads((EXAMPLES / example / "parameters.json").read_text())
    motors = search_motor(_load(EXAMPLES / example / "rocket.ork"), datapoints, labels)
    for key, value in motors.items():
        expected = committed["motors"][key]
        if isinstance(value, (tuple, list)):
            assert list(value) == list(expected), key
        elif isinstance(value, str):
            assert value == expected, key
        else:
            assert value == pytest.approx(expected, rel=1e-6), key
    assert len(motors) == 14
    assert identity["config_id"] == stored["config_id"]
