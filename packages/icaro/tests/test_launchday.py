"""Tests for icaro.launchday — L1 checklist and rail recommendation.

Unit tests replace ``build_nominal_flight`` and RocketPy's ``Flight`` inside
``icaro.launchday`` with light fakes, so no real flight is solved. One
``integration``-marked test runs a real 2x2 sweep on the committed
``Serializer-export-rockets/v1.5.0`` export.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from types import SimpleNamespace

import pytest

from icaro.launchday import (
    LaunchCheck,
    LaunchLimits,
    RailCandidate,
    RailSweep,
    evaluate_rail,
    launch_checks,
    recommend_rail,
)
from icaro.scenario import Atmosphere, Rail, Scenario, Site, Wind

REPO_ROOT = Path(__file__).resolve().parents[3]
REAL_EXPORT = REPO_ROOT / "Serializer-export-rockets" / "v1.5.0"

ELEVATION = 220.0


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _candidate(**overrides) -> RailCandidate:
    values = dict(
        inclination=86.0,
        heading=240.0,
        apogee_agl=500.0,
        landing_distance=120.0,
        landing_bearing=225.0,
        out_of_rail_velocity=20.0,
        stability_margin_min=2.0,
        impact_velocity=5.5,
        checks_ok=True,
    )
    values.update(overrides)
    return RailCandidate(**values)


def _by_id(checks: list[LaunchCheck]) -> dict[str, LaunchCheck]:
    return {c.id: c for c in checks}


def _scenario(wind: Wind | None = None, rail: Rail | None = None) -> Scenario:
    return Scenario(
        name="t",
        site=Site(latitude=41.734, longitude=0.1076, elevation=ELEVATION),
        atmosphere=Atmosphere(model="standard_atmosphere"),
        rail=rail,
        wind=wind,
    )


def _fake_flight(x=0.0, y=0.0, apogee_agl=500.0, margin=2.0, impact=-5.5, rail_v=20.0):
    return SimpleNamespace(
        apogee=ELEVATION + apogee_agl,
        apogee_time=10.0,
        x_impact=x,
        y_impact=y,
        out_of_rail_velocity=rail_v,
        out_of_rail_time=0.5,
        impact_velocity=impact,
        stability_margin=lambda t: margin,
    )


class _Harness:
    """Fake build_nominal_flight + Flight driven by a {(inc, hdg): kwargs} table."""

    def __init__(self, table, nominal=None, env_wind=(0.0, 0.0), params_flight=None):
        self.table = table
        self.nominal = nominal or _fake_flight(x=50.0, y=0.0)
        self.env = SimpleNamespace(
            elevation=ELEVATION,
            heights=[],
            wind_velocity_x=lambda h: (self.env.heights.append(h), env_wind[0])[1],
            wind_velocity_y=lambda h: env_wind[1],
        )
        self.rocket = object()
        self.params = {
            "flight": params_flight
            or {"rail_length": 2.0, "inclination": 87.0, "heading": 90.0}
        }
        self.flight_kwargs = []
        self.builds = 0

    def build(self, export_dir, scenario):
        self.builds += 1
        print("rocketpy chatter from the nominal build")
        return self.nominal, self.rocket, object(), self.env, self.params

    def flight(self, **kwargs):
        print("rocketpy chatter from a candidate")
        self.flight_kwargs.append(kwargs)
        spec = self.table[(kwargs["inclination"], kwargs["heading"])]
        if isinstance(spec, Exception):
            raise spec
        return _fake_flight(**spec)


@pytest.fixture
def harness(monkeypatch):
    def install(*args, **kwargs):
        h = _Harness(*args, **kwargs)
        monkeypatch.setattr("icaro.launchday.build_nominal_flight", h.build)
        monkeypatch.setattr("icaro.launchday.Flight", h.flight)
        return h

    return install


# ---------------------------------------------------------------------------
# S4 — limits and checks
# ---------------------------------------------------------------------------


def test_launch_limits_defaults_match_the_l1_guide():
    limits = LaunchLimits()
    assert limits.apogee_max_m == 1000
    assert limits.apogee_recommended_max_m == 600
    assert limits.tilt_max_deg == 20
    assert limits.static_margin_min_cal == 1.5
    assert limits.descent_max_ms == 10
    assert limits.descent_recommended_ms == (5, 6)
    assert limits.landing_radius_m == 500
    assert limits.rail_exit_min_ms == 15
    assert limits.wind_max_kmh == 32
    assert json.loads(json.dumps(limits.to_dict()))["descent_recommended_ms"] == [5, 6]


def test_launch_checks_all_pass_for_a_nominal_candidate():
    checks = launch_checks(_candidate(), wind_speed_ms=3.0)

    assert [c.id for c in checks] == [
        "apogee_max",
        "apogee_recommended",
        "tilt_max",
        "static_margin_min",
        "descent_max",
        "descent_recommended",
        "landing_radius",
        "rail_exit_min",
        "wind_max",
    ]
    assert all(c.ok for c in checks)
    by_id = _by_id(checks)
    assert by_id["tilt_max"].value == pytest.approx(4.0)
    assert by_id["tilt_max"].comparator == "<="
    assert by_id["wind_max"].value == pytest.approx(10.8)  # km/h
    assert by_id["descent_recommended"].comparator == "between"
    assert by_id["descent_recommended"].limit == [5, 6]
    assert by_id["static_margin_min"].comparator == ">="


def test_launch_checks_hard_failures():
    checks = _by_id(
        launch_checks(
            _candidate(
                apogee_agl=1100.0,
                inclination=65.0,
                stability_margin_min=1.2,
                impact_velocity=12.0,
            ),
            wind_speed_ms=10.0,  # 36 km/h
        )
    )
    for check_id, source in [
        ("apogee_max", "PROP-003"),
        ("tilt_max", "PROP-003"),
        ("static_margin_min", "PROP-004"),
        ("descent_max", "REC-003"),
        ("wind_max", "Operativa 5.1"),
    ]:
        assert checks[check_id].ok is False
        assert checks[check_id].severity == "hard"
        assert checks[check_id].source == source


def test_launch_checks_soft_failures_leave_hard_checks_green():
    checks = _by_id(
        launch_checks(
            _candidate(
                apogee_agl=700.0,
                impact_velocity=8.0,
                landing_distance=650.0,
                out_of_rail_velocity=12.0,
            ),
            wind_speed_ms=3.0,
        )
    )
    for check_id in ("apogee_recommended", "descent_recommended", "landing_radius", "rail_exit_min"):
        assert checks[check_id].ok is False
        assert checks[check_id].severity == "soft"
    assert checks["rail_exit_min"].source == "practice"
    assert checks["apogee_max"].ok and checks["descent_max"].ok


# ---------------------------------------------------------------------------
# S3 — rail recommendation
# ---------------------------------------------------------------------------


def test_recommend_rail_sorts_and_prefers_candidates_that_pass_hard_checks(harness):
    h = harness(
        {
            (90, 0): dict(x=10.0, y=0.0, margin=1.0),  # closest, fails PROP-004
            (90, 180): dict(x=0.0, y=-80.0),
            (86, 0): dict(x=-100.0, y=-100.0),
            (86, 180): dict(x=300.0, y=0.0),
        }
    )

    sweep = recommend_rail("export", _scenario(), inclinations=(90, 86), headings=(0, 180))

    assert isinstance(sweep, RailSweep)
    distances = [c.landing_distance for c in sweep.candidates]
    assert distances == sorted(distances)
    assert sweep.candidates[0].checks_ok is False
    assert (sweep.best.inclination, sweep.best.heading) == (90, 180)
    assert sweep.best.landing_distance == pytest.approx(80.0)
    assert sweep.best.landing_bearing == pytest.approx(180.0)
    # One nominal build, then one flight per grid point reusing its objects.
    assert h.builds == 1
    assert len(h.flight_kwargs) == 4
    assert all(kw["rocket"] is h.rocket and kw["environment"] is h.env for kw in h.flight_kwargs)
    assert {kw["rail_length"] for kw in h.flight_kwargs} == {2.0}
    assert sweep.checks_best is not None
    assert {c.id for c in sweep.checks_current} == {c.id for c in sweep.checks_best}


def test_recommend_rail_falls_back_to_closest_when_nothing_passes(harness):
    harness(
        {
            (90, 0): dict(x=200.0, margin=1.0),
            (90, 90): dict(x=50.0, margin=1.0),
        }
    )

    sweep = recommend_rail("export", _scenario(), inclinations=(90,), headings=(0, 90))

    assert sweep.best.checks_ok is False
    assert sweep.best.heading == 90


def test_recommend_rail_reports_skipped_candidates(harness):
    harness(
        {
            (90, 0): dict(x=10.0),
            (90, 90): RuntimeError("solver diverged"),
        }
    )

    sweep = recommend_rail("export", _scenario(), inclinations=(90,), headings=(0, 90))

    assert [c.heading for c in sweep.candidates] == [0]
    assert len(sweep.skipped) == 1
    assert sweep.skipped[0].inclination == 90 and sweep.skipped[0].heading == 90
    assert "solver diverged" in sweep.skipped[0].error


def test_recommend_rail_with_no_successful_candidate_has_no_best(harness):
    harness({(90, 0): RuntimeError("boom")})

    sweep = recommend_rail("export", _scenario(), inclinations=(90,), headings=(0,))

    assert sweep.best is None and sweep.checks_best is None
    assert sweep.candidates == []


def test_recommend_rail_is_silent(harness, capsys):
    harness({(90, 0): dict(x=10.0)})

    recommend_rail("export", _scenario(), inclinations=(90,), headings=(0,))

    assert capsys.readouterr().out == ""


def test_current_uses_scenario_rail_over_export(harness):
    h = harness({}, nominal=_fake_flight(x=-30.0, y=40.0))
    scenario = _scenario(rail=Rail(length=3.0, inclination=84.0))

    sweep = recommend_rail("export", scenario, inclinations=(), headings=())

    assert sweep.current.inclination == 84.0
    assert sweep.current.heading == 90.0  # export value
    assert sweep.current.landing_distance == pytest.approx(50.0)
    assert sweep.current.landing_bearing == pytest.approx(math.degrees(math.atan2(-30, 40)) % 360)
    assert h.flight_kwargs == []


def test_candidate_metrics(harness):
    nominal = _fake_flight(x=-100.0, y=-100.0, apogee_agl=480.0, impact=-5.2)
    margins = {}

    def margin(t):
        margins[t] = None
        return 0.1 if t < 0.5 else 2.0 + abs(t - 6.0)  # min 2.0 at t = 6

    nominal.stability_margin = margin
    harness({}, nominal=nominal)

    candidate = evaluate_rail("export", _scenario(), None, None)

    assert candidate.apogee_agl == pytest.approx(480.0)
    assert candidate.landing_distance == pytest.approx(math.hypot(100, 100))
    assert candidate.landing_bearing == pytest.approx(225.0)
    assert candidate.impact_velocity == pytest.approx(5.2)
    assert candidate.stability_margin_min == pytest.approx(2.0, abs=0.3)
    assert min(margins) >= 0.5 and max(margins) <= 10.0
    assert len(margins) >= 15


def test_evaluate_rail_flies_the_requested_setting(harness):
    h = harness({(84, 270): dict(x=5.0)})

    candidate = evaluate_rail("export", _scenario(), 84, 270)

    assert (candidate.inclination, candidate.heading) == (84, 270)
    assert candidate.landing_distance == pytest.approx(5.0)
    assert h.flight_kwargs[0]["inclination"] == 84


def test_wind_used_manual(harness):
    harness({})
    sweep = recommend_rail(
        "export", _scenario(wind=Wind(speed=5.0, direction_from=270)), inclinations=(), headings=()
    )
    assert (sweep.wind.speed, sweep.wind.direction_from, sweep.wind.source) == (5.0, 270.0, "manual")


def test_wind_used_from_model_reads_pad_height_plus_ten(harness):
    h = harness({}, env_wind=(3.0, 4.0))  # blowing NE → comes from the SW

    sweep = recommend_rail("export", _scenario(), inclinations=(), headings=())

    assert sweep.wind.source == "model"
    assert sweep.wind.speed == pytest.approx(5.0)
    assert sweep.wind.direction_from == pytest.approx(math.degrees(math.atan2(-3, -4)) % 360)
    assert h.env.heights == [ELEVATION + 10]


def test_manual_wind_too_strong_fails_every_candidate(harness):
    harness({(90, 0): dict(x=10.0)})
    sweep = recommend_rail(
        "export",
        _scenario(wind=Wind(speed=10.0, direction_from=0)),
        inclinations=(90,),
        headings=(0,),
    )
    assert sweep.best.checks_ok is False
    assert _by_id(sweep.checks_best)["wind_max"].ok is False


@pytest.mark.parametrize(
    "inclinations, headings, message",
    [
        ((90, 60), (0,), "inclination"),
        ((91,), (0,), "inclination"),
        ((90,), (360,), "heading"),
        (tuple(range(70, 91)), tuple(range(0, 360, 30)), "100"),
    ],
)
def test_recommend_rail_rejects_invalid_grids(harness, inclinations, headings, message):
    h = harness({})
    with pytest.raises(ValueError, match=message):
        recommend_rail("export", _scenario(), inclinations=inclinations, headings=headings)
    assert h.builds == 0


def test_sweep_to_dict_is_json_round_trippable(harness):
    harness({(90, 0): dict(x=10.0), (90, 90): RuntimeError("boom")})

    sweep = recommend_rail("export", _scenario(), inclinations=(90,), headings=(0, 90))
    data = json.loads(json.dumps(sweep.to_dict()))

    assert set(data) == {
        "wind",
        "current",
        "best",
        "candidates",
        "skipped",
        "limits",
        "checks_current",
        "checks_best",
    }
    assert data["wind"]["source"] == "model"
    assert set(data["best"]) == {
        "inclination",
        "heading",
        "apogee_agl",
        "landing_distance",
        "landing_bearing",
        "out_of_rail_velocity",
        "stability_margin_min",
        "impact_velocity",
        "checks_ok",
    }
    assert set(data["checks_current"][0]) == {
        "id", "value", "limit", "comparator", "ok", "severity", "source"
    }
    assert data["skipped"] == [{"inclination": 90, "heading": 90, "error": "RuntimeError: boom"}]
    assert data["limits"]["wind_max_kmh"] == 32


# ---------------------------------------------------------------------------
# Integration — real sweep on the committed export
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_real_rail_sweep_with_manual_wind():
    scenario = _scenario(wind=Wind(speed=5.0, direction_from=270))

    sweep = recommend_rail(REAL_EXPORT, scenario, inclinations=(90, 84), headings=(90, 270))

    assert sweep.skipped == []
    assert len(sweep.candidates) == 4
    assert sweep.wind.source == "manual"
    by_setting = {(c.inclination, c.heading): c for c in sweep.candidates}
    # Wind from the west pushes the landing east of the pad when flying straight up
    # (and weathercocking pulls the ascent west: either way the landing moves).
    assert by_setting[(90, 90)].landing_distance > 1.0
    assert by_setting[(84, 90)].landing_distance != pytest.approx(
        by_setting[(84, 270)].landing_distance, abs=1.0
    )
    for c in sweep.candidates:
        assert c.apogee_agl > 0
        assert c.out_of_rail_velocity > 0
        assert c.impact_velocity > 0
        assert 0 <= c.landing_bearing < 360
        assert math.isfinite(c.stability_margin_min)
    assert sweep.best is not None
    json.dumps(sweep.to_dict())
    print(json.dumps(sweep.to_dict(), indent=1))
