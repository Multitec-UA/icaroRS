"""Tests for icaro.series — extract_flight_series.

Pure unit tests: a tiny callable-Function fake stands in for a solved
rocketpy Flight (no rocketpy, no sim). The use-case must resample each
flight Function onto a uniform time grid and return plain JSON-safe lists.

Coverage:
- Shape: returns t + named series + path3d, all aligned to one t grid.
- Resampling: t spans [0, t_final], honours max_points.
- Alignment: sampled values equal the underlying Function at each t.
- path3d is (East, North, Up) = (x, y, altitude AGL), so it starts at origin.
- Defensive: a missing series attribute is omitted, never crashes.
- Guard: max_points < 2 raises ValueError.
"""

from __future__ import annotations

import pytest

from icaro.series import extract_flight_series


class _Fn:
    """Minimal callable double for a rocketpy ``Function`` (callable at any t)."""

    def __init__(self, f):
        self._f = f

    def __call__(self, t):
        return self._f(t)


class FakeFlight:
    """A solved-flight double whose series are simple closed-form functions."""

    def __init__(self, t_final: float = 10.0) -> None:
        self.t_final = t_final
        self.altitude = _Fn(lambda t: 100.0 * t)  # AGL, starts at 0
        self.speed = _Fn(lambda t: 50.0)
        self.mach_number = _Fn(lambda t: 0.1 * t)
        self.acceleration = _Fn(lambda t: 9.8)
        self.x = _Fn(lambda t: 2.0 * t)  # East
        self.y = _Fn(lambda t: 3.0 * t)  # North


def test_returns_expected_keys():
    s = extract_flight_series(FakeFlight(), max_points=100)
    assert set(s) == {"t", "altitude", "speed", "mach", "acceleration", "path3d"}


def test_time_grid_spans_full_flight_and_honours_max_points():
    s = extract_flight_series(FakeFlight(t_final=10.0), max_points=50)
    assert len(s["t"]) == 50
    assert s["t"][0] == pytest.approx(0.0)
    assert s["t"][-1] == pytest.approx(10.0)
    # Uniform spacing.
    assert s["t"][1] - s["t"][0] == pytest.approx(10.0 / 49)


def test_all_series_aligned_to_time_grid():
    s = extract_flight_series(FakeFlight(), max_points=20)
    n = len(s["t"])
    for key in ("altitude", "speed", "mach", "acceleration"):
        assert len(s[key]) == n
    assert len(s["path3d"]) == n


def test_sampled_values_match_underlying_functions():
    s = extract_flight_series(FakeFlight(t_final=10.0), max_points=11)
    # t = 0,1,2,...,10
    assert s["altitude"][5] == pytest.approx(100.0 * 5)
    assert s["mach"][10] == pytest.approx(0.1 * 10)
    assert s["speed"][3] == pytest.approx(50.0)


def test_path3d_is_east_north_up():
    s = extract_flight_series(FakeFlight(t_final=10.0), max_points=11)
    # at t=4: x=8, y=12, altitude=400
    assert s["path3d"][4] == pytest.approx([8.0, 12.0, 400.0])


def test_values_are_plain_json_safe_floats():
    s = extract_flight_series(FakeFlight(), max_points=5)
    assert all(isinstance(v, float) for v in s["altitude"])
    assert all(isinstance(c, float) for pt in s["path3d"] for c in pt)


def test_missing_series_attribute_is_omitted_not_crash():
    flight = FakeFlight()
    del flight.mach_number
    s = extract_flight_series(flight, max_points=10)
    assert "mach" not in s
    # The rest still present.
    assert "altitude" in s and "path3d" in s


def test_max_points_below_two_raises():
    with pytest.raises(ValueError):
        extract_flight_series(FakeFlight(), max_points=1)
