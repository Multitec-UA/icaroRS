"""Tests for icaro.montecarlo — build_stochastic, run_monte_carlo.

Unit tests patch rocketpy (stochastic models, MonteCarlo) and
``build_nominal_flight`` so no network, JVM or real flight is needed.
One ``integration``-marked smoke test runs a real low-n Monte Carlo on the
committed ``Serializer-export-rockets/v1.5.0`` export with a standard
atmosphere (no network).
"""

from __future__ import annotations

import json
import time
import warnings
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import icaro.montecarlo as mc_module
from icaro import MonteCarloResult, build_stochastic, run_monte_carlo
from icaro.scenario import DEFAULT_UNCERTAINTY, Atmosphere, Dispersion, Scenario, Site

RAW_WARNING = (
    "This class is still under testing and some attributes may be changed in "
    "next versions"
)

# Every run emits the relabelled advisory; tests asserting on it opt back in.
pytestmark = pytest.mark.filterwarnings("ignore:Monte Carlo dispersion runs")

REPO_ROOT = Path(__file__).resolve().parents[3]
REAL_EXPORT = REPO_ROOT / "Serializer-export-rockets" / "v1.5.0"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _scenario(uncertainty: dict[str, Dispersion] | None = None) -> Scenario:
    return Scenario(
        name="mc-test",
        site=Site(latitude=38.37, longitude=-0.58, elevation=120.0),
        atmosphere=Atmosphere(model="standard_atmosphere"),
        uncertainty=uncertainty,
    )


def _nominal():
    """Fake nominal objects carrying the values build_stochastic reads."""
    env = SimpleNamespace(latitude=38.37, longitude=-0.58, elevation=120.0)
    motor = SimpleNamespace(total_impulse=1000.0)
    rocket = SimpleNamespace(
        mass=20.0, aerodynamic_surfaces=[], parachutes=[], rail_buttons=[]
    )
    flight = SimpleNamespace(rail_length=5.0, inclination=84.0, heading=90.0)
    return flight, rocket, motor, env, {}


@pytest.fixture
def patched_models(monkeypatch):
    """Patch build_nominal_flight and every Stochastic* class with mocks."""
    monkeypatch.setattr(mc_module, "build_nominal_flight", lambda *a, **k: _nominal())
    mocks = {}
    for name in (
        "StochasticEnvironment",
        "StochasticRocket",
        "StochasticSolidMotor",
        "StochasticFlight",
    ):
        mocks[name] = MagicMock(name=name)
        monkeypatch.setattr(mc_module, name, mocks[name])
    return mocks


def _kwargs(mock: MagicMock) -> dict:
    assert mock.call_count == 1
    return mock.call_args.kwargs


class FakeMonteCarlo:
    """Stands in for rocketpy.MonteCarlo: writes NDJSON lines like the real one.

    ``plan`` is a list of outcomes; each is either a dict of outputs
    (success) or an error string (failure).
    """

    plan: list = []
    extra_warning: str | None = None
    instances: list = []

    def __init__(self, filename, environment, rocket, flight, **kwargs):
        warnings.warn(RAW_WARNING, UserWarning)
        if FakeMonteCarlo.extra_warning:
            warnings.warn(FakeMonteCarlo.extra_warning, UserWarning)
        self.filename = Path(filename)
        self.environment, self.rocket, self.flight = environment, rocket, flight
        self.simulate_kwargs = None
        self.kml_calls = []
        FakeMonteCarlo.instances.append(self)

    def _path(self, kind):
        return self.filename.with_suffix(f".{kind}.txt")

    def simulate(self, number_of_simulations, **kwargs):
        self.simulate_kwargs = {"number_of_simulations": number_of_simulations, **kwargs}
        for kind in ("inputs", "outputs", "errors"):
            self._path(kind).write_text("")
        for idx, outcome in enumerate(self.plan[:number_of_simulations], start=1):
            inputs = {"index": idx, "mass": 20.0 + idx}
            if isinstance(outcome, dict):
                with open(self._path("inputs"), "a") as f:
                    f.write(json.dumps(inputs) + "\n")
                with open(self._path("outputs"), "a") as f:
                    f.write(json.dumps({"index": idx, **outcome}) + "\n")
            else:
                with open(self._path("errors"), "a") as f:
                    f.write(json.dumps({**inputs, "error": outcome}) + "\n")
            time.sleep(0.02)

    def export_ellipses_to_kml(self, filename, origin_lat, origin_lon, **kwargs):
        self.kml_calls.append((filename, origin_lat, origin_lon, kwargs))
        Path(filename).write_text("<kml/>")


def _success(apogee: float, x: float, y: float) -> dict:
    return {
        "apogee": apogee,
        "apogee_x": x / 2,
        "apogee_y": y / 2,
        "x_impact": x,
        "y_impact": y,
    }


@pytest.fixture
def fake_mc(monkeypatch, patched_models):
    FakeMonteCarlo.plan = []
    FakeMonteCarlo.extra_warning = None
    FakeMonteCarlo.instances = []
    monkeypatch.setattr(mc_module, "MonteCarlo", FakeMonteCarlo)
    monkeypatch.setattr(mc_module, "_PROGRESS_POLL_S", 0.005)
    return FakeMonteCarlo


SUCCESS_PLAN = [
    _success(1120.0, 100.0, 50.0),
    _success(1220.0, 140.0, 20.0),
    _success(1020.0, 80.0, 90.0),
    "RuntimeError: boom",
    _success(1170.0, 120.0, 60.0),
]


# ---------------------------------------------------------------------------
# build_stochastic — dispersion mapping (S2)
# ---------------------------------------------------------------------------


def test_relative_dispersions_are_scaled_by_the_nominal_value(patched_models):
    scenario = _scenario(
        {
            "mass": Dispersion(std=0.05, kind="relative"),
            "thrust": Dispersion(std=0.03, kind="relative"),
            "rail_length": Dispersion(std=0.05, kind="relative"),
            "wind_factor": Dispersion(std=0.10, kind="relative"),
        }
    )
    build_stochastic("export", scenario)

    assert _kwargs(patched_models["StochasticRocket"])["mass"] == pytest.approx(1.0)
    motor_kw = _kwargs(patched_models["StochasticSolidMotor"])
    assert motor_kw["total_impulse"] == pytest.approx(30.0)
    flight_kw = _kwargs(patched_models["StochasticFlight"])
    assert flight_kw["rail_length"] == pytest.approx(0.25)
    env_kw = _kwargs(patched_models["StochasticEnvironment"])
    assert env_kw["wind_velocity_x_factor"] == pytest.approx((1.0, 0.10))
    assert env_kw["wind_velocity_y_factor"] == pytest.approx((1.0, 0.10))


def test_absolute_dispersions_map_directly(patched_models):
    scenario = _scenario(
        {
            "inclination": Dispersion(std=2.0, kind="absolute"),
            "heading": Dispersion(std=3.0, kind="absolute"),
            "mass": Dispersion(std=0.5, kind="absolute"),
            "thrust": Dispersion(std=12.0, kind="absolute"),
        }
    )
    build_stochastic("export", scenario)

    flight_kw = _kwargs(patched_models["StochasticFlight"])
    assert flight_kw["inclination"] == pytest.approx(2.0)
    assert flight_kw["heading"] == pytest.approx(3.0)
    assert _kwargs(patched_models["StochasticRocket"])["mass"] == pytest.approx(0.5)
    motor_kw = _kwargs(patched_models["StochasticSolidMotor"])
    assert motor_kw["total_impulse"] == pytest.approx(12.0)


def test_missing_uncertainty_block_uses_default_uncertainty(patched_models):
    # Scenario.model_validate (API path) leaves uncertainty None.
    models = build_stochastic("export", _scenario(None))

    assert models.uncertainty == DEFAULT_UNCERTAINTY
    assert _kwargs(patched_models["StochasticRocket"])["mass"] == pytest.approx(1.0)
    flight_kw = _kwargs(patched_models["StochasticFlight"])
    assert flight_kw["inclination"] == pytest.approx(2.0)
    assert flight_kw["heading"] == pytest.approx(2.0)
    assert flight_kw["rail_length"] == pytest.approx(0.25)
    motor_kw = _kwargs(patched_models["StochasticSolidMotor"])
    assert motor_kw["total_impulse"] == pytest.approx(30.0)
    env_kw = _kwargs(patched_models["StochasticEnvironment"])
    assert env_kw["wind_velocity_x_factor"] == pytest.approx((1.0, 0.10))


def test_no_scenario_uses_default_uncertainty(patched_models):
    models = build_stochastic("export", None)
    assert models.uncertainty == DEFAULT_UNCERTAINTY


def test_empty_uncertainty_block_uses_default_uncertainty(patched_models):
    # The web always sends ``uncertainty: {}``; an empty budget would make
    # every sampled flight identical, so it means "the defaults".
    models = build_stochastic("export", _scenario({}))

    assert models.uncertainty == DEFAULT_UNCERTAINTY
    assert _kwargs(patched_models["StochasticRocket"])["mass"] == pytest.approx(1.0)


def test_partial_uncertainty_disperses_only_listed_keys(patched_models):
    build_stochastic(
        "export", _scenario({"heading": Dispersion(std=2.0, kind="absolute")})
    )

    flight_kw = _kwargs(patched_models["StochasticFlight"])
    assert flight_kw["heading"] == pytest.approx(2.0)
    assert flight_kw["inclination"] is None
    assert flight_kw["rail_length"] is None
    assert _kwargs(patched_models["StochasticRocket"])["mass"] is None
    assert _kwargs(patched_models["StochasticSolidMotor"])["total_impulse"] is None
    env_kw = _kwargs(patched_models["StochasticEnvironment"])
    assert env_kw["wind_velocity_x_factor"] == (1.0, 0.0)


def test_unknown_uncertainty_key_raises_naming_allowed_keys(patched_models):
    scenario = _scenario({"drag": Dispersion(std=0.1, kind="relative")})

    with pytest.raises(ValueError) as excinfo:
        build_stochastic("export", scenario)

    message = str(excinfo.value)
    assert "drag" in message
    for key in DEFAULT_UNCERTAINTY:
        assert key in message


def test_build_stochastic_exposes_the_nominal_environment(patched_models):
    models = build_stochastic("export", _scenario())
    assert models.nominal_environment.latitude == 38.37
    assert models.environment is patched_models["StochasticEnvironment"].return_value
    assert models.rocket is patched_models["StochasticRocket"].return_value
    assert models.motor is patched_models["StochasticSolidMotor"].return_value
    assert models.flight is patched_models["StochasticFlight"].return_value
    # The stochastic motor is attached to the stochastic rocket.
    models.rocket.add_motor.assert_called_once_with(models.motor)


def test_nominal_surfaces_are_carried_into_the_stochastic_rocket():
    # Real rocketpy surfaces: RocketPy's own wrapping of plain surfaces in
    # StochasticRocket is broken (component= kwarg), so icaro wraps them.
    from rocketpy import FreeFormFins, NoseCone, StochasticNoseCone

    nose = NoseCone(length=0.3, kind="vonKarman", base_radius=0.05, rocket_radius=0.05)
    fins = FreeFormFins(
        n=4,
        shape_points=[(0, 0), (0.05, 0.08), (0.1, 0.08), (0.12, 0)],
        rocket_radius=0.05,
    )
    rocket = SimpleNamespace(
        aerodynamic_surfaces=[(nose, 1.0), (fins, -0.5)],
        parachutes=[],
        rail_buttons=[],
    )
    stochastic_rocket = MagicMock()

    mc_module._add_surfaces(stochastic_rocket, rocket)

    (wrapped_nose, nose_position), _ = stochastic_rocket.add_nose.call_args
    assert isinstance(wrapped_nose, StochasticNoseCone)
    assert wrapped_nose.obj is nose
    assert nose_position == [1.0]
    args, _ = stochastic_rocket._add_surfaces.call_args
    assert isinstance(args[0], mc_module._FixedSurface)
    assert args[0].obj is fins
    assert args[1] == [-0.5]
    assert args[0].create_object() is not fins  # each sample gets a copy


# ---------------------------------------------------------------------------
# run_monte_carlo (S3–S6)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("n", [0, -3])
def test_run_monte_carlo_rejects_non_positive_n(fake_mc, tmp_path, n):
    with pytest.raises(ValueError, match="n"):
        run_monte_carlo("export", _scenario(), n, tmp_path / "run")


def test_run_monte_carlo_writes_parseable_ndjson_files(fake_mc, tmp_path):
    fake_mc.plan = SUCCESS_PLAN
    result = run_monte_carlo("export", _scenario(), 5, tmp_path / "run")

    assert result.inputs_path == tmp_path / "run.inputs.txt"
    assert result.outputs_path == tmp_path / "run.outputs.txt"
    assert result.errors_path == tmp_path / "run.errors.txt"
    for path in (result.inputs_path, result.outputs_path, result.errors_path):
        assert path.exists()
        for line in path.read_text().splitlines():
            json.loads(line)
    assert len(result.errors_path.read_text().splitlines()) == 1


def test_run_monte_carlo_keeps_dots_in_the_prefix(fake_mc, tmp_path):
    fake_mc.plan = SUCCESS_PLAN
    result = run_monte_carlo("export", _scenario(), 5, tmp_path / "run.v1")
    assert result.inputs_path == tmp_path / "run.v1.inputs.txt"
    assert result.inputs_path.exists()


def test_run_monte_carlo_skips_failed_simulations_and_forwards_parallel(
    fake_mc, tmp_path
):
    fake_mc.plan = SUCCESS_PLAN
    result = run_monte_carlo(
        "export", _scenario(), 5, tmp_path / "run", parallel=True, workers=3
    )

    kwargs = fake_mc.instances[0].simulate_kwargs
    assert kwargs["number_of_simulations"] == 5
    assert kwargs["skip_failed_simulations"] is True
    assert kwargs["parallel"] is True
    assert kwargs["n_workers"] == 3
    # Function data (drag/thrust curves) would make each input line megabytes.
    assert kwargs["include_function_data"] is False
    assert result.raw is fake_mc.instances[0]


def test_run_monte_carlo_computes_counts_and_apogee_agl_stats(fake_mc, tmp_path):
    fake_mc.plan = SUCCESS_PLAN
    result = run_monte_carlo("export", _scenario(), 5, tmp_path / "run")

    assert isinstance(result, MonteCarloResult)
    assert (result.n_requested, result.n_succeeded, result.n_failed) == (5, 4, 1)
    # Elevation 120 m: apogee ASL → AGL.
    assert result.apogee_agl == pytest.approx([1000.0, 1100.0, 900.0, 1050.0])
    stats = result.apogee_stats
    assert stats.mean == pytest.approx(1012.5)
    assert stats.min == pytest.approx(900.0)
    assert stats.max == pytest.approx(1100.0)
    assert stats.p50 == pytest.approx(1025.0)
    assert stats.p5 < stats.p50 < stats.p95
    assert stats.std > 0
    assert result.impact_x == pytest.approx([100.0, 140.0, 80.0, 120.0])
    assert result.impact_y == pytest.approx([50.0, 20.0, 90.0, 60.0])


def test_run_monte_carlo_returns_three_landing_ellipses_and_a_kml(fake_mc, tmp_path):
    fake_mc.plan = SUCCESS_PLAN
    result = run_monte_carlo("export", _scenario(), 5, tmp_path / "run")

    assert len(result.landing_ellipses) == 3
    assert len(result.apogee_ellipses) == 3
    for ellipse in result.landing_ellipses + result.apogee_ellipses:
        assert len(ellipse) > 10
        lat, lon = ellipse[0]
        assert 37.0 < lat < 40.0
        assert -2.0 < lon < 1.0
    assert result.kml_path == tmp_path / "run.kml"
    assert result.kml_path.exists()
    filename, lat, lon, _ = fake_mc.instances[0].kml_calls[0]
    assert Path(filename) == result.kml_path
    assert (lat, lon) == (38.37, -0.58)


def test_run_monte_carlo_relabels_the_rocketpy_warning(fake_mc, tmp_path):
    fake_mc.plan = SUCCESS_PLAN
    fake_mc.extra_warning = "unrelated advisory"
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("always")
        run_monte_carlo("export", _scenario(), 5, tmp_path / "run")

    messages = [str(w.message) for w in caught]
    assert not any("under testing" in m for m in messages)
    icaro_messages = [m for m in messages if m == mc_module.MONTE_CARLO_WARNING]
    assert len(icaro_messages) == 1
    assert "unrelated advisory" in messages


def test_run_monte_carlo_reports_progress_ending_with_total(fake_mc, tmp_path):
    fake_mc.plan = SUCCESS_PLAN
    calls = []
    run_monte_carlo(
        "export",
        _scenario(),
        5,
        tmp_path / "run",
        on_progress=lambda done, total: calls.append((done, total)),
    )

    assert calls[-1] == (5, 5)
    assert all(total == 5 and 0 <= done <= 5 for done, total in calls)
    dones = [done for done, _ in calls]
    assert dones == sorted(dones)


def test_run_monte_carlo_ignores_stale_files_from_a_previous_run(fake_mc, tmp_path):
    stale = "\n".join(json.dumps({"index": i}) for i in range(50)) + "\n"
    for kind in ("inputs", "outputs", "errors"):
        (tmp_path / f"run.{kind}.txt").write_text(stale)
    fake_mc.plan = SUCCESS_PLAN
    calls = []
    run_monte_carlo(
        "export",
        _scenario(),
        5,
        tmp_path / "run",
        on_progress=lambda done, total: calls.append((done, total)),
    )
    assert all(done <= 5 for done, _ in calls)


def test_run_monte_carlo_handles_an_all_failed_run(fake_mc, tmp_path):
    fake_mc.plan = ["RuntimeError: a", "RuntimeError: b", "ValueError: c"]
    calls = []
    result = run_monte_carlo(
        "export",
        _scenario(),
        3,
        tmp_path / "run",
        on_progress=lambda done, total: calls.append((done, total)),
    )

    assert (result.n_requested, result.n_succeeded, result.n_failed) == (3, 0, 3)
    assert result.apogee_stats is None
    assert result.apogee_agl == []
    assert result.landing_ellipses == []
    assert result.apogee_ellipses == []
    assert result.kml_path is None
    assert not (tmp_path / "run.kml").exists()
    assert fake_mc.instances[0].kml_calls == []
    assert calls[-1] == (3, 3)
    json.dumps(result.to_dict())


def test_to_dict_is_json_serializable_without_raw(fake_mc, tmp_path):
    fake_mc.plan = SUCCESS_PLAN
    result = run_monte_carlo("export", _scenario(), 5, tmp_path / "run")

    data = json.loads(json.dumps(result.to_dict()))
    assert "raw" not in data
    assert data["n_succeeded"] == 4
    assert data["apogee_stats"]["mean"] == pytest.approx(1012.5)
    assert data["files"]["kml"] == str(tmp_path / "run.kml")
    assert len(data["landing_ellipses"]) == 3
    assert data["origin"] == {"latitude": 38.37, "longitude": -0.58}
    # The budget that was actually dispersed travels with the result, so a
    # surface can explain what varied (S15).
    assert data["uncertainty"]["mass"] == {"std": 0.05, "kind": "relative"}
    assert data["uncertainty"]["inclination"] == {"std": 2.0, "kind": "absolute"}
    assert set(data["uncertainty"]) == set(DEFAULT_UNCERTAINTY)


# ---------------------------------------------------------------------------
# Integration — real low-n run (S13, S14)
# ---------------------------------------------------------------------------


def _find_values(node, key):
    """Collect every value stored under ``key`` anywhere in a nested JSON."""
    found = []
    if isinstance(node, dict):
        for k, v in node.items():
            if k == key:
                found.append(v)
            found.extend(_find_values(v, key))
    elif isinstance(node, list):
        for item in node:
            found.extend(_find_values(item, key))
    return found


@pytest.mark.integration
def test_real_monte_carlo_smoke_run(tmp_path):
    scenario = _scenario(None)  # DEFAULT_UNCERTAINTY, standard atmosphere
    calls = []
    result = run_monte_carlo(
        REAL_EXPORT,
        scenario,
        5,
        tmp_path / "smoke",
        on_progress=lambda done, total: calls.append((done, total)),
    )

    assert result.n_requested == 5
    assert result.n_succeeded + result.n_failed == 5
    assert result.n_succeeded >= 3
    assert calls[-1] == (5, 5)
    for path in (result.inputs_path, result.outputs_path, result.errors_path):
        for line in path.read_text().splitlines():
            json.loads(line)
    assert result.kml_path is not None and result.kml_path.exists()
    assert len(result.landing_ellipses) == 3
    assert result.apogee_stats.min > 0
    json.dumps(result.to_dict())

    # S14: thrust dispersion must actually vary the motor total impulse.
    impulses = [
        value
        for line in result.inputs_path.read_text().splitlines()
        for value in _find_values(json.loads(line), "total_impulse")
    ]
    assert len(impulses) == result.n_succeeded
    assert len(set(impulses)) > 1
    # Without function data each input line stays small.
    assert result.inputs_path.stat().st_size < 100_000
