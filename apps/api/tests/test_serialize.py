"""Tests for icaro_api.serialize — Flight serialization adapter.

All tests are pure unit tests (no network, no JVM, no real rocketpy sim).
Uses ``FakeFlight`` from ``tests.fakes`` as the Flight stub.

TDD: written BEFORE serialize.py is implemented (RED phase).

Coverage:
  AC-RG-5.1 — scalars are JSON-serializable, minimum required keys present
  AC-RG-5.2 — at least 3 PNG files written to run directory
  Defensive getattr — missing attr on Flight must not raise (task 1.16)
  Warnings passthrough — captured warnings appear in output (AC-RG-2.6 partial)
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path
from types import SimpleNamespace

import pytest

# These imports will fail until serialize.py is implemented (RED phase).
from icaro_api.serialize import serialize_flight

from tests.fakes import FakeFlight


# ---------------------------------------------------------------------------
# Happy-path tests — full FakeFlight with all attrs
# ---------------------------------------------------------------------------


class TestSerializeFlightHappyPath:
    def test_returns_dict_with_expected_top_keys(self, tmp_path):
        """Result must have run_id, scalars, plot_urls, warnings keys."""
        flight = FakeFlight()
        run_id = "run-001"
        result = serialize_flight(flight, tmp_path, run_id, [])
        assert set(result.keys()) >= {"run_id", "scalars", "plot_urls", "warnings"}

    def test_run_id_in_result(self, tmp_path):
        """run_id in result must match the supplied value."""
        result = serialize_flight(FakeFlight(), tmp_path, "run-abc", [])
        assert result["run_id"] == "run-abc"

    def test_scalars_json_serializable(self, tmp_path):
        """json.dumps(scalars) must not raise (AC-RG-5.1)."""
        result = serialize_flight(FakeFlight(), tmp_path, "run-002", [])
        # Should not raise
        dumped = json.dumps(result["scalars"])
        assert len(dumped) > 2  # non-empty JSON object

    def test_minimum_scalar_keys_present(self, tmp_path):
        """All minimum required scalar keys from RG-5.1 must be present."""
        result = serialize_flight(FakeFlight(), tmp_path, "run-003", [])
        scalars = result["scalars"]
        required_keys = {
            "apogee_m",
            "apogee_time_s",
            "max_velocity_ms",
            "max_mach",
            "max_acceleration_ms2",
            "rail_departure_velocity_ms",
            "impact_velocity_ms",
            "flight_time_s",
        }
        missing = required_keys - set(scalars.keys())
        assert not missing, f"Missing scalar keys: {missing}"

    def test_scalars_are_floats_or_none(self, tmp_path):
        """All scalar values must be float/int/None — no Function objects."""
        result = serialize_flight(FakeFlight(), tmp_path, "run-004", [])
        for key, val in result["scalars"].items():
            assert val is None or isinstance(val, (int, float)), (
                f"Scalar {key!r} has non-JSON type {type(val)}"
            )

    def test_at_least_three_pngs_written(self, tmp_path):
        """At least 3 PNG files must exist in the run directory (AC-RG-5.2)."""
        run_id = "run-005"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])
        run_dir = tmp_path / run_id
        pngs = list(run_dir.glob("*.png"))
        assert len(pngs) >= 3, f"Expected ≥3 PNGs, found {len(pngs)}: {pngs}"

    def test_plot_urls_non_empty(self, tmp_path):
        """plot_urls must be a non-empty list of strings."""
        result = serialize_flight(FakeFlight(), tmp_path, "run-006", [])
        urls = result["plot_urls"]
        assert isinstance(urls, list) and len(urls) >= 3
        for url in urls:
            assert isinstance(url, str) and url.startswith("/api/results/")

    def test_skipped_plot_not_advertised(self, tmp_path):
        """A plot method that returns WITHOUT writing a file (e.g. rocketpy's
        rail_buttons_bending_moments when button_height is undefined) must NOT
        produce a plot_url — otherwise the UI shows a broken image."""
        flight = FakeFlight()
        # Make one method a no-op that writes nothing (mirrors the real skip).
        flight.plots.rail_buttons_bending_moments = lambda *, filename=None: None

        result = serialize_flight(flight, tmp_path, "run-skip", [])
        urls = result["plot_urls"]

        assert not any("rail_bending_moments.png" in u for u in urls)
        # Other plots still rendered and advertised.
        assert any("rail_forces.png" in u for u in urls)
        assert not (tmp_path / "run-skip" / "rail_bending_moments.png").exists()

    def test_warnings_empty_when_none_captured(self, tmp_path):
        """warnings list must be empty when no warnings were captured."""
        result = serialize_flight(FakeFlight(), tmp_path, "run-007", [])
        assert result["warnings"] == []

    def test_result_json_written_to_run_dir(self, tmp_path):
        """result.json must be written inside the run directory."""
        run_id = "run-008"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])
        result_json = tmp_path / run_id / "result.json"
        assert result_json.exists(), "result.json not found in run directory"
        loaded = json.loads(result_json.read_text())
        assert "scalars" in loaded


# ---------------------------------------------------------------------------
# Time-series persistence (issue #11) — serialize writes series.json alongside
# result.json so GET /api/results/{run_id}/series can serve it later.
# ---------------------------------------------------------------------------


class TestSerializeFlightSeries:
    def test_series_json_written_to_run_dir(self, tmp_path):
        """series.json must be written inside the run directory."""
        run_id = "run-series-1"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])
        series_json = tmp_path / run_id / "series.json"
        assert series_json.exists(), "series.json not found in run directory"

    def test_series_json_has_expected_keys(self, tmp_path):
        """series.json must hold t + named series + path3d (issue #11 shape)."""
        run_id = "run-series-2"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])
        series = json.loads((tmp_path / run_id / "series.json").read_text())
        assert set(series) == {"t", "altitude", "speed", "mach", "acceleration", "path3d"}

    def test_series_arrays_aligned_and_json_safe(self, tmp_path):
        """Every series aligns to the t grid and is JSON-serializable."""
        run_id = "run-series-3"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])
        series = json.loads((tmp_path / run_id / "series.json").read_text())
        n = len(series["t"])
        assert n >= 2
        for key in ("altitude", "speed", "mach", "acceleration", "path3d"):
            assert len(series[key]) == n

    def test_result_json_shape_unchanged(self, tmp_path):
        """Adding series must NOT change the result.json contract (additive)."""
        run_id = "run-series-4"
        result = serialize_flight(FakeFlight(), tmp_path, run_id, [])
        assert set(result.keys()) == {"run_id", "scalars", "plot_urls", "warnings"}

    def test_series_extraction_failure_does_not_break_serialize(self, tmp_path):
        """If series extraction blows up, serialize_flight must still succeed
        (series are a bonus, never a hard dependency)."""
        flight = FakeFlight()
        del flight.t_final  # extract_flight_series reads t_final → will raise
        result = serialize_flight(flight, tmp_path, "run-series-5", [])
        assert isinstance(result, dict) and "scalars" in result
        # No series.json (extraction failed) — but the run still serialized.
        assert not (tmp_path / "run-series-5" / "series.json").exists()


# ---------------------------------------------------------------------------
# Warnings passthrough tests (AC-RG-2.6 partial)
# ---------------------------------------------------------------------------


class TestSerializeFlightWarnings:
    def test_captured_warning_appears_in_output(self, tmp_path):
        """A captured UserWarning must appear as a string in warnings list."""
        w = warnings.WarningMessage(
            message=UserWarning("GFS forecast unavailable; using standard atmosphere"),
            category=UserWarning,
            filename="icaro/simulation.py",
            lineno=42,
            source=None,
        )
        result = serialize_flight(FakeFlight(), tmp_path, "run-009", [w])
        assert len(result["warnings"]) == 1
        assert "standard atmosphere" in result["warnings"][0].lower()

    def test_multiple_warnings_all_in_output(self, tmp_path):
        """Multiple captured warnings must all appear in the warnings list."""
        ws = [
            warnings.WarningMessage(
                message=UserWarning(f"Warning {i}"),
                category=UserWarning,
                filename="x.py",
                lineno=i,
                source=None,
            )
            for i in range(3)
        ]
        result = serialize_flight(FakeFlight(), tmp_path, "run-010", ws)
        assert len(result["warnings"]) == 3


# ---------------------------------------------------------------------------
# Defensive getattr — missing scalar attribute (task 1.16)
# ---------------------------------------------------------------------------


class TestSerializeFlightDefensive:
    def test_missing_attr_does_not_raise(self, tmp_path):
        """If a scalar attr is missing, serialize_flight must NOT raise."""
        flight = FakeFlight()
        del flight.max_mach_number  # simulate a Flight that lacks this attr
        # Must not raise KeyError or AttributeError
        result = serialize_flight(flight, tmp_path, "run-011", [])
        assert isinstance(result, dict)

    def test_missing_attr_key_omitted_from_scalars(self, tmp_path):
        """Missing attr → key simply absent from scalars dict."""
        flight = FakeFlight()
        del flight.max_mach_number
        result = serialize_flight(flight, tmp_path, "run-012", [])
        # The key must be absent — not None, not raising
        assert "max_mach" not in result["scalars"]

    def test_other_scalars_still_present_when_one_missing(self, tmp_path):
        """Other scalars must still be present when one attr is missing."""
        flight = FakeFlight()
        del flight.max_mach_number
        result = serialize_flight(flight, tmp_path, "run-013", [])
        # apogee_m is a different attr — must still be there
        assert "apogee_m" in result["scalars"]

    def test_all_scalars_missing_returns_empty_scalars(self, tmp_path):
        """If all scalar attrs are missing, scalars must be an empty dict."""
        flight = FakeFlight()
        scalar_attrs = [
            "apogee", "apogee_time", "apogee_x", "apogee_y",
            "t_final", "x_impact", "y_impact", "impact_velocity",
            "max_speed", "max_speed_time", "max_mach_number",
            "max_acceleration", "max_acceleration_time",
            "out_of_rail_velocity", "out_of_rail_time",
            "out_of_rail_stability_margin",
        ]
        for attr in scalar_attrs:
            if hasattr(flight, attr):
                delattr(flight, attr)
        result = serialize_flight(flight, tmp_path, "run-014", [])
        assert isinstance(result["scalars"], dict)


# ---------------------------------------------------------------------------
# Apogee reference frame — MSL → AGL correction
#
# rocketpy reports apogee above SEA LEVEL (raw Z), but the altitude chart is
# above GROUND LEVEL. With a forecast atmosphere rocketpy overrides the env
# elevation with terrain height, so the two diverge by env.elevation. The
# summary apogee must be expressed AGL so it agrees with the chart's peak.
# ---------------------------------------------------------------------------


class TestApogeeAboveGroundLevel:
    def test_apogee_corrected_to_agl_when_env_present(self, tmp_path):
        """apogee_m = flight.apogee - env.elevation (matches the chart's peak)."""
        flight = FakeFlight()
        flight.apogee = 736.0
        flight.env = SimpleNamespace(elevation=151.5)
        result = serialize_flight(flight, tmp_path, "run-agl-1", [])
        assert result["scalars"]["apogee_m"] == pytest.approx(584.5)

    def test_apogee_unchanged_at_sea_level(self, tmp_path):
        """elevation 0 (e.g. site at sea level) → AGL equals MSL."""
        flight = FakeFlight()
        flight.apogee = 1_000.0
        flight.env = SimpleNamespace(elevation=0.0)
        result = serialize_flight(flight, tmp_path, "run-agl-2", [])
        assert result["scalars"]["apogee_m"] == pytest.approx(1_000.0)

    def test_horizontal_apogee_components_not_corrected(self, tmp_path):
        """apogee_x / apogee_y are horizontal — elevation must NOT touch them."""
        flight = FakeFlight()
        flight.apogee_x = 42.1
        flight.apogee_y = 17.8
        flight.env = SimpleNamespace(elevation=151.5)
        result = serialize_flight(flight, tmp_path, "run-agl-3", [])
        assert result["scalars"]["apogee_x_m"] == pytest.approx(42.1)
        assert result["scalars"]["apogee_y_m"] == pytest.approx(17.8)

    def test_apogee_preserved_when_env_missing(self, tmp_path):
        """Defensive: no env on the flight → raw value kept, no crash."""
        flight = FakeFlight()  # FakeFlight has no `env`
        flight.apogee = 1_423.5
        assert not hasattr(flight, "env")
        result = serialize_flight(flight, tmp_path, "run-agl-4", [])
        assert result["scalars"]["apogee_m"] == pytest.approx(1_423.5)

    def test_apogee_preserved_when_elevation_not_numeric(self, tmp_path):
        """Defensive: env.elevation not a number → raw value kept, no crash."""
        flight = FakeFlight()
        flight.apogee = 500.0
        flight.env = SimpleNamespace(elevation=None)
        result = serialize_flight(flight, tmp_path, "run-agl-5", [])
        assert result["scalars"]["apogee_m"] == pytest.approx(500.0)
