"""Tests for icaro.interop: the mt-interop simulation payload and the comparison.

Pure unit tests: a callable-Function double stands in for a solved rocketpy
Flight (no rocketpy, no simulation). The payload must follow contract v1
(SI units, t = 0 at liftoff, flat equal-length arrays, at most 2000 points,
specific force for acc_ms2) and the comparison must align, diff and warn.
"""

from __future__ import annotations

import math
from pathlib import Path

import pytest
from icaro.interop import (
    INTEROP_REAL_FLIGHT_SCHEMA,
    INTEROP_SIMULATION_SCHEMA,
    MAX_SERIES_POINTS,
    InteropSchemaError,
    compare_with_real_flight,
    interop_simulation_from_series,
    interop_simulation_payload,
)

G = 9.8


class _Fn:
    def __init__(self, f):
        self._f = f

    def __call__(self, t):
        return self._f(t)


class _Parachute:
    def __init__(self, name: str, lag: float) -> None:
        self.name = name
        self.lag = lag


class _Env:
    latitude = 41.7299
    longitude = 0.1042
    elevation = 233.0
    gravity = _Fn(lambda z: G)


class _Motor:
    burn_out_time = 2.0


class _Rocket:
    motor = _Motor()


class FakeFlight:
    """Ballistic up to apogee at t = 10 s (v0 = 98 m/s, a = -g), 30 s flight."""

    def __init__(self) -> None:
        self.t_final = 30.0
        self.env = _Env()
        self.rocket = _Rocket()
        self.out_of_rail_time = 0.3
        self.apogee_time = 10.0
        self.apogee = 233.0 + 490.0  # MSL, like RocketPy
        self.max_speed = 98.0
        self.parachute_events = [[0.0, _Parachute("Main", 14.0)]]
        self.altitude = _Fn(lambda t: 98.0 * t - 0.5 * G * t * t if t <= 10 else 490.0 - 24.5 * (t - 10))
        self.z = _Fn(lambda t: 233.0 + self.altitude(t))
        self.vz = _Fn(lambda t: 98.0 - G * t if t <= 10 else -24.5)
        self.speed = _Fn(lambda t: abs(self.vz(t)))
        self.x = _Fn(lambda t: 2.0 * t)
        self.y = _Fn(lambda t: -1.0 * t)
        self.ax = _Fn(lambda t: 3.0)
        self.ay = _Fn(lambda t: 4.0)
        self.az = _Fn(lambda t: -G)  # free fall: specific force only from ax, ay


def _real_doc(**overrides) -> dict:
    ts = [i * 0.5 for i in range(61)]  # 0..30 s at 2 Hz
    alt = [98.0 * t - 0.5 * G * t * t if t <= 10 else 490.0 - 24.5 * (t - 10) for t in ts]
    alt = [a - 10.0 for a in alt]  # real flew 10 m lower everywhere
    vz = [98.0 - G * t if t <= 10 else -24.5 for t in ts]
    doc = {
        "schema": INTEROP_REAL_FLIGHT_SCHEMA,
        "flight_id": "MT1-00279-9a1a6300",
        "device_id": "mt1-a",
        "rocket": "MT1",
        "launch_utc": "2026-10-18T10:12:00Z",
        "pad": {"lat": 41.7299, "lon": 0.1042, "elev_m": 233.0},
        "events": [
            {"id": "liftoff", "t": 0.0, "label": "Liftoff", "source": "fsm"},
            {"id": "apogee", "t": 10.05, "label": "Apogee", "source": "fsm"},
            {"id": "ejection", "t": 16.06, "label": "Ejection", "source": "fsm"},
            {"id": "deploy", "t": 17.5, "label": "Chute open", "source": "derived"},
            {"id": "landing", "t": 29.0, "label": "Landing", "source": "derived"},
            {"id": "wobble", "t": 3.0, "label": "Unknown event", "source": "fsm"},
        ],
        "stats": {"apogee_m": 480.0, "apogee_t": 10.05, "vmax_ms": 96.0, "amax_ms2": 70.0, "landing_t": 29.0},
        "series": {"t": ts, "alt_m": alt, "vz_ms": vz, "acc_ms2": [5.0] * len(ts)},
        "rate_hz": 2,
    }
    doc.update(overrides)
    return doc


# ---------------------------------------------------------------------------
# interop_simulation_payload
# ---------------------------------------------------------------------------


def test_payload_has_contract_keys_and_equal_length_series():
    p = interop_simulation_payload(FakeFlight(), max_points=301)
    assert set(p) == {"site", "events", "stats", "series"}
    assert set(p["series"]) == {"t", "alt_m", "vz_ms", "speed_ms", "acc_ms2", "x_m", "y_m"}
    assert {len(v) for v in p["series"].values()} == {301}
    assert p["series"]["t"][0] == 0.0
    assert p["series"]["t"][-1] == pytest.approx(30.0)


def test_payload_defaults_to_the_contract_cap_and_rejects_more():
    p = interop_simulation_payload(FakeFlight())
    assert len(p["series"]["t"]) == MAX_SERIES_POINTS
    with pytest.raises(ValueError):
        interop_simulation_payload(FakeFlight(), max_points=MAX_SERIES_POINTS + 1)


def test_payload_acc_is_specific_force_magnitude():
    p = interop_simulation_payload(FakeFlight(), max_points=11)
    # ax=3, ay=4, az + g = 0  ->  |f| = 5
    assert p["series"]["acc_ms2"] == pytest.approx([5.0] * 11)
    assert p["stats"]["amax_ms2"] == pytest.approx(5.0)


def test_payload_stats_use_apogee_above_the_pad():
    p = interop_simulation_payload(FakeFlight(), max_points=11)
    assert p["stats"] == {
        "apogee_m": pytest.approx(490.0),
        "apogee_t": pytest.approx(10.0),
        "vmax_ms": pytest.approx(98.0),
        "amax_ms2": pytest.approx(5.0),
        "flight_time_s": pytest.approx(30.0),
    }


def test_payload_events_include_deploy_at_trigger_plus_lag():
    p = interop_simulation_payload(FakeFlight(), max_points=11)
    ids = [(e["id"], e["t"]) for e in p["events"]]
    assert ids == [
        ("liftoff", 0.0),
        ("rail_exit", 0.3),
        ("burnout", 2.0),
        ("apogee", 10.0),
        ("deploy", 14.0),
        ("landing", 30.0),
    ]
    deploy = next(e for e in p["events"] if e["id"] == "deploy")
    assert deploy["label"] == "Deploy: Main"


def test_payload_one_deploy_per_parachute():
    flight = FakeFlight()
    flight.parachute_events = [[10.0, _Parachute("Drogue", 1.0)], [20.0, _Parachute("Main", 0.5)]]
    p = interop_simulation_payload(flight, max_points=11)
    deploys = [e["t"] for e in p["events"] if e["id"] == "deploy"]
    assert deploys == [11.0, 20.5]


def test_payload_site_from_environment():
    p = interop_simulation_payload(FakeFlight(), max_points=11)
    assert p["site"] == {"lat": 41.7299, "lon": 0.1042, "elev_m": 233.0}


def test_payload_omits_series_the_flight_cannot_give():
    flight = FakeFlight()
    del flight.ax
    del flight.vz
    p = interop_simulation_payload(flight, max_points=11)
    assert "acc_ms2" not in p["series"] and "vz_ms" not in p["series"]
    assert p["stats"]["amax_ms2"] is None


# ---------------------------------------------------------------------------
# interop_simulation_from_series (runs older than the payload)
# ---------------------------------------------------------------------------


def test_from_series_derives_vz_and_flags_approximate():
    ts = [float(i) for i in range(11)]
    series = {"t": ts, "altitude": [10.0 * t for t in ts], "speed": [10.0] * 11, "path3d": [[t, -t, 10 * t] for t in ts]}
    scalars = {"apogee_m": 100.0, "apogee_time_s": 10.0, "flight_time_s": 10.0, "rail_departure_time_s": 0.2, "max_velocity_ms": 10.0}
    p = interop_simulation_from_series(series, scalars, site={"lat": 1.0, "lon": 2.0, "elev_m": None})
    assert p["approximate"] is True
    assert p["series"]["vz_ms"] == pytest.approx([10.0] * 11)
    assert p["series"]["x_m"][3] == 3.0 and p["series"]["y_m"][3] == -3.0
    assert "acc_ms2" not in p["series"]
    assert [e["id"] for e in p["events"]] == ["liftoff", "rail_exit", "apogee", "landing"]
    assert p["stats"]["amax_ms2"] is None
    assert p["site"] == {"lat": 1.0, "lon": 2.0, "elev_m": None}


def test_from_series_rejects_unusable_series():
    with pytest.raises(InteropSchemaError):
        interop_simulation_from_series({"t": [0.0]}, {})


# ---------------------------------------------------------------------------
# compare_with_real_flight
# ---------------------------------------------------------------------------


def _sim() -> dict:
    return interop_simulation_payload(FakeFlight(), max_points=301)


def test_compare_validates_the_real_schema():
    with pytest.raises(InteropSchemaError):
        compare_with_real_flight(_sim(), _real_doc(schema="mt-interop/real-flight@2"))
    with pytest.raises(InteropSchemaError):
        compare_with_real_flight(_sim(), {k: v for k, v in _real_doc().items() if k != "schema"})


def test_compare_validates_the_sim_schema_when_present():
    sim = dict(_sim(), schema="something-else")
    with pytest.raises(InteropSchemaError):
        compare_with_real_flight(sim, _real_doc())
    sim["schema"] = INTEROP_SIMULATION_SCHEMA
    compare_with_real_flight(sim, _real_doc())


def test_compare_rejects_series_without_alt():
    doc = _real_doc()
    doc["series"] = {"t": [0.0, 1.0], "vz_ms": [0.0, 1.0]}
    with pytest.raises(InteropSchemaError):
        compare_with_real_flight(_sim(), doc)


def test_compare_aligns_series_on_one_grid():
    c = compare_with_real_flight(_sim(), _real_doc())
    n = len(c.t)
    assert 2 <= n <= 1000
    # The grid is never finer than the coarser input (real at 0.5 s).
    assert c.t[1] - c.t[0] >= 0.5 - 1e-9
    for side in (c.sim, c.real):
        assert set(side) == {"alt_m", "vz_ms", "acc_ms2"}
        assert all(len(v) == n for v in side.values())


def test_compare_rmse_of_a_constant_offset():
    c = compare_with_real_flight(_sim(), _real_doc())
    assert c.rmse["alt_m"] == pytest.approx(10.0, abs=0.05)
    assert c.rmse["vz_ms"] == pytest.approx(0.0, abs=0.05)
    assert c.rmse["acc_ms2"] == pytest.approx(0.0, abs=1e-6)
    assert c.window == (0.0, 30.0)


def test_compare_kpis_are_sim_minus_real():
    c = compare_with_real_flight(_sim(), _real_doc())
    kpis = {k.id: k for k in c.kpis}
    assert kpis["apogee_m"].delta == pytest.approx(10.0)
    assert kpis["apogee_m"].delta_pct == pytest.approx(10.0 / 480.0 * 100, abs=0.01)
    assert kpis["apogee_t"].delta == pytest.approx(-0.05)
    assert kpis["vmax_ms"].delta == pytest.approx(2.0)
    assert kpis["landing_t"].sim == pytest.approx(30.0)
    assert kpis["landing_t"].delta == pytest.approx(1.0)


def test_compare_event_deltas_ignore_unknown_ids():
    c = compare_with_real_flight(_sim(), _real_doc())
    by_id = {}
    for e in c.events:
        by_id.setdefault(e.id, []).append(e)
    assert "wobble" not in by_id and "liftoff" not in by_id
    apogee = by_id["apogee"][0]
    assert apogee.sim_value == pytest.approx(490.0) and apogee.real_value == pytest.approx(480.0)
    assert apogee.delta_t == pytest.approx(-0.05)
    deploy = by_id["deploy"][0]
    assert deploy.sim_t == 14.0 and deploy.real_t == 17.5 and deploy.delta_t == pytest.approx(-3.5)
    assert deploy.value_unit == "m" and deploy.real_value is not None
    ejection = by_id["ejection"][0]
    assert ejection.sim_t is None and ejection.real_t == 16.06 and ejection.delta_t is None
    burnout = by_id["burnout"][0]
    assert burnout.sim_t == 2.0 and burnout.real_t is None


def test_compare_warns_about_one_sim_parachute_against_ejection_and_deploy():
    c = compare_with_real_flight(_sim(), _real_doc())
    assert "single_deploy" in {w.code for w in c.warnings}


def test_compare_warns_when_sites_are_more_than_a_km_apart():
    near = compare_with_real_flight(_sim(), _real_doc())
    assert near.site_distance_m == pytest.approx(0.0, abs=0.1)
    assert "site_far" not in {w.code for w in near.warnings}
    far = compare_with_real_flight(_sim(), _real_doc(pad={"lat": 41.75, "lon": 0.1042, "elev_m": 233.0}))
    warning = next(w for w in far.warnings if w.code == "site_far")
    assert warning.value == pytest.approx(0.0201 * 111_195, abs=2)


def test_compare_warns_when_pad_unknown_and_series_missing():
    doc = _real_doc(pad=None)
    del doc["series"]["acc_ms2"]
    c = compare_with_real_flight(_sim(), doc)
    codes = {w.code for w in c.warnings}
    assert {"pad_unknown", "missing_acc_ms2"} <= codes
    assert c.rmse["acc_ms2"] is None
    assert "acc_ms2" not in c.real


def test_compare_marks_values_outside_a_side_as_none():
    doc = _real_doc()
    keep = 25  # real recording stops at 12 s
    doc["series"] = {k: v[:keep] for k, v in doc["series"].items()}
    c = compare_with_real_flight(_sim(), doc)
    assert c.real["alt_m"][-1] is None
    assert c.sim["alt_m"][-1] is not None
    assert c.window == (0.0, 12.0)
    assert "real_ends_early" not in {w.code for w in c.warnings}  # 12 s > apogee at 10 s


def test_compare_with_an_approximate_sim_warns():
    ts = [float(i) for i in range(31)]
    series = {"t": ts, "altitude": [FakeFlight().altitude(t) for t in ts]}
    sim = interop_simulation_from_series(series, {"apogee_m": 490.0, "apogee_time_s": 10.0, "flight_time_s": 30.0})
    c = compare_with_real_flight(sim, _real_doc())
    codes = {w.code for w in c.warnings}
    assert {"sim_approximate", "missing_acc_ms2"} <= codes
    assert c.rmse["alt_m"] == pytest.approx(10.0, abs=0.5)


def test_to_dict_is_json_shaped():
    import json

    d = compare_with_real_flight(_sim(), _real_doc()).to_dict()
    json.dumps(d)
    assert set(d) == {"series", "events", "kpis", "rmse", "window", "warnings", "site_distance_m"}
    assert set(d["series"]) == {"t", "sim", "real"}
    assert d["window"] == {"t_start": 0.0, "t_end": 30.0}
    assert all(math.isfinite(v) for v in d["series"]["t"])


# ---------------------------------------------------------------------------
# Integration: MT1 v1.7.1 export, a real solved Flight
# ---------------------------------------------------------------------------


_V171 = Path(__file__).resolve().parents[3] / "Serializer-export-rockets" / "v1.7.1"


@pytest.mark.integration
@pytest.mark.skipif(not (_V171 / "parameters.json").exists(), reason="no v1.7.1 export")
def test_mt1_v171_payload_and_comparison_with_flight_279_numbers():
    import warnings

    from icaro import simulate_from_export

    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        flight = simulate_from_export(_V171)
    p = interop_simulation_payload(flight)

    assert len(p["series"]["t"]) == MAX_SERIES_POINTS
    assert 300 < p["stats"]["apogee_m"] < 1000  # above the pad
    assert p["stats"]["amax_ms2"] > 30  # boost, specific force
    deploys = [e for e in p["events"] if e["id"] == "deploy"]
    assert len(deploys) == 1 and deploys[0]["t"] == pytest.approx(14.0, abs=0.5)
    # On the pad the accelerometer reads about 1 g before the motor builds up.
    assert p["series"]["acc_ms2"][0] > 5

    real = _real_doc(stats={"apogee_m": 459.0, "apogee_t": 10.05, "vmax_ms": 100.0, "amax_ms2": 70.0, "landing_t": 120.0})
    c = compare_with_real_flight(p, real)
    assert c.rmse["alt_m"] is not None
    assert "single_deploy" in {w.code for w in c.warnings}
