"""Tests for icaro.scenario — Scenario YAML loading and validation.

All tests are pure unit tests (no network, no JVM, no filesystem except
temporary YAML fixtures). TDD: each test was written BEFORE the implementation
to drive the design of scenario.py.

Coverage targets: SCN-1 through SCN-8, REQ-SCN-01 through REQ-SCN-11.
"""

from __future__ import annotations

import textwrap
from pathlib import Path

import pytest
import yaml

# These imports will fail until scenario.py is implemented (RED phase).
from icaro.scenario import (
    DEFAULT_UNCERTAINTY,
    Scenario,
    ScenarioValidationError,
    load_scenario,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def write_yaml(tmp_path: Path, content: str) -> Path:
    """Write a YAML string to a temp file and return its path."""
    p = tmp_path / "scenario.yaml"
    p.write_text(textwrap.dedent(content))
    return p


# ---------------------------------------------------------------------------
# SCN-1 — Happy path: full scenario with all blocks
# ---------------------------------------------------------------------------


def test_scn1_happy_path_full_scenario(tmp_path):
    """SCN-1: valid YAML with all fields returns a populated Scenario."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: test_launch
        site:
          latitude: 38.37
          longitude: -0.58
          elevation: 120.0
        date:
          year: 2025
          month: 6
          day: 15
          hour: 12
        atmosphere:
          model: forecast
          file: GFS
          fallback: standard_atmosphere
        rail:
          length: 5.0
          inclination: 84.0
          heading: 90.0
        uncertainty:
          mass:
            std: 0.05
            kind: relative
          inclination:
            std: 2.0
            kind: absolute
        """,
    )

    scenario = load_scenario(yaml_path)

    assert isinstance(scenario, Scenario)
    assert scenario.name == "test_launch"
    assert scenario.site.latitude == pytest.approx(38.37)
    assert scenario.site.longitude == pytest.approx(-0.58)
    assert scenario.site.elevation == pytest.approx(120.0)
    assert scenario.date.year == 2025
    assert scenario.date.month == 6
    assert scenario.date.day == 15
    assert scenario.date.hour == 12
    assert scenario.atmosphere.model == "forecast"
    assert scenario.atmosphere.file == "GFS"
    assert scenario.atmosphere.fallback == "standard_atmosphere"
    assert scenario.rail.length == pytest.approx(5.0)
    assert scenario.rail.inclination == pytest.approx(84.0)
    assert scenario.rail.heading == pytest.approx(90.0)
    assert scenario.uncertainty["mass"].std == pytest.approx(0.05)
    assert scenario.uncertainty["mass"].kind == "relative"
    assert scenario.uncertainty["inclination"].std == pytest.approx(2.0)
    assert scenario.uncertainty["inclination"].kind == "absolute"


# ---------------------------------------------------------------------------
# SCN-2 — Uncertainty auto-fill when block omitted
# ---------------------------------------------------------------------------


def test_scn2_missing_uncertainty_filled_from_template(tmp_path):
    """SCN-2: absent uncertainty block → Scenario.uncertainty equals DEFAULT_UNCERTAINTY."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: no_uncertainty
        site:
          latitude: 38.37
          longitude: -0.58
        atmosphere:
          model: standard_atmosphere
        """,
    )

    scenario = load_scenario(yaml_path)

    # All six default uncertainty keys must be present and match DEFAULT_UNCERTAINTY.
    assert scenario.uncertainty is not None
    for key, default_disp in DEFAULT_UNCERTAINTY.items():
        assert key in scenario.uncertainty, f"Missing uncertainty key: {key}"
        assert scenario.uncertainty[key].std == pytest.approx(default_disp.std)
        assert scenario.uncertainty[key].kind == default_disp.kind


# ---------------------------------------------------------------------------
# SCN-3 — Partial uncertainty override: only listed keys; no backfill
# ---------------------------------------------------------------------------


def test_scn3_partial_uncertainty_no_backfill(tmp_path):
    """SCN-3: partial uncertainty block → only listed keys present, no backfill."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: partial_uncertainty
        site:
          latitude: 38.37
          longitude: -0.58
        atmosphere:
          model: standard_atmosphere
        uncertainty:
          mass:
            std: 0.08
            kind: relative
        """,
    )

    scenario = load_scenario(yaml_path)

    assert "mass" in scenario.uncertainty
    assert scenario.uncertainty["mass"].std == pytest.approx(0.08)
    # Other keys must NOT be backfilled from the template.
    for key in DEFAULT_UNCERTAINTY:
        if key != "mass":
            assert key not in scenario.uncertainty, (
                f"Key '{key}' was unexpectedly backfilled from template"
            )


# ---------------------------------------------------------------------------
# SCN-4 — Missing site.latitude → validation error
# ---------------------------------------------------------------------------


def test_scn4_missing_site_latitude_raises(tmp_path):
    """SCN-4: missing site.latitude raises ScenarioValidationError naming the field."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: bad_site
        site:
          longitude: -0.58
        atmosphere:
          model: standard_atmosphere
        """,
    )

    with pytest.raises(ScenarioValidationError) as exc_info:
        load_scenario(yaml_path)

    assert "latitude" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# SCN-5 — Forecast without date block → validation error
# ---------------------------------------------------------------------------


def test_scn5_forecast_without_date_raises(tmp_path):
    """SCN-5: atmosphere.model=forecast but no date block → ScenarioValidationError."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: no_date
        site:
          latitude: 38.37
          longitude: -0.58
        atmosphere:
          model: forecast
        """,
    )

    with pytest.raises(ScenarioValidationError) as exc_info:
        load_scenario(yaml_path)

    assert "date" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# SCN-6 — Unknown atmosphere model → validation error
# ---------------------------------------------------------------------------


def test_scn6_unknown_atmosphere_model_raises(tmp_path):
    """SCN-6: unknown atmosphere.model value raises ScenarioValidationError."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: bad_model
        site:
          latitude: 38.37
          longitude: -0.58
        atmosphere:
          model: windy
        """,
    )

    with pytest.raises(ScenarioValidationError):
        load_scenario(yaml_path)


# ---------------------------------------------------------------------------
# SCN-7 — Reanalysis without atmosphere.file → validation error
# ---------------------------------------------------------------------------


def test_scn7_reanalysis_without_file_raises(tmp_path):
    """SCN-7: atmosphere.model=reanalysis but no atmosphere.file raises ScenarioValidationError."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: reanalysis_no_file
        site:
          latitude: 38.37
          longitude: -0.58
        date:
          year: 2020
          month: 1
          day: 1
          hour: 0
        atmosphere:
          model: reanalysis
        """,
    )

    with pytest.raises(ScenarioValidationError) as exc_info:
        load_scenario(yaml_path)

    error_text = str(exc_info.value).lower()
    assert "file" in error_text or "atmosphere" in error_text


# ---------------------------------------------------------------------------
# SCN-8 — Uncertainty parameter missing kind → validation error
# ---------------------------------------------------------------------------


def test_scn8_uncertainty_missing_kind_raises(tmp_path):
    """SCN-8: uncertainty entry without 'kind' raises ScenarioValidationError referencing kind."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: missing_kind
        site:
          latitude: 38.37
          longitude: -0.58
        atmosphere:
          model: standard_atmosphere
        uncertainty:
          mass:
            std: 0.05
        """,
    )

    with pytest.raises(ScenarioValidationError) as exc_info:
        load_scenario(yaml_path)

    assert "kind" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# REQ-SCN-06 — Fallback defaults to standard_atmosphere when omitted
# ---------------------------------------------------------------------------


def test_req_scn06_fallback_defaults_to_standard_atmosphere(tmp_path):
    """REQ-SCN-06: omitting atmosphere.fallback defaults to 'standard_atmosphere'."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: no_fallback
        site:
          latitude: 38.37
          longitude: -0.58
        atmosphere:
          model: standard_atmosphere
        """,
    )

    scenario = load_scenario(yaml_path)
    assert scenario.atmosphere.fallback == "standard_atmosphere"


# ---------------------------------------------------------------------------
# REQ-SCN-09 — Rail overrides are individually optional
# ---------------------------------------------------------------------------


def test_req_scn09_rail_fields_individually_optional(tmp_path):
    """REQ-SCN-09: each rail field is optional; present ones load, absent ones are None."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: partial_rail
        site:
          latitude: 38.37
          longitude: -0.58
        atmosphere:
          model: standard_atmosphere
        rail:
          inclination: 80.0
        """,
    )

    scenario = load_scenario(yaml_path)
    assert scenario.rail is not None
    assert scenario.rail.inclination == pytest.approx(80.0)
    assert scenario.rail.length is None
    assert scenario.rail.heading is None


# ---------------------------------------------------------------------------
# REQ-SCN-10 — Elevation fallback: None when absent
# ---------------------------------------------------------------------------


def test_req_scn10_elevation_optional_is_none_when_absent(tmp_path):
    """REQ-SCN-10: site.elevation absent → site.elevation is None (caller uses export value)."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: no_elevation
        site:
          latitude: 38.37
          longitude: -0.58
        atmosphere:
          model: standard_atmosphere
        """,
    )

    scenario = load_scenario(yaml_path)
    assert scenario.site.elevation is None


# ---------------------------------------------------------------------------
# REQ-SCN-11 — Malformed YAML raises ScenarioValidationError
# ---------------------------------------------------------------------------


def test_req_scn11_malformed_yaml_raises(tmp_path):
    """REQ-SCN-11: file with syntax error is not valid YAML → raises ScenarioValidationError."""
    bad_path = tmp_path / "bad.yaml"
    bad_path.write_text("name: [unclosed bracket\nsite:\n  latitude: : bad")

    with pytest.raises(ScenarioValidationError):
        load_scenario(bad_path)


# ---------------------------------------------------------------------------
# REQ-SCN-05 — wyoming_sounding requires station
# ---------------------------------------------------------------------------


def test_wyoming_sounding_without_station_raises(tmp_path):
    """REQ-SCN-05: wyoming_sounding without station raises ScenarioValidationError."""
    yaml_path = write_yaml(
        tmp_path,
        """
        name: wyoming_no_station
        site:
          latitude: 38.37
          longitude: -0.58
        date:
          year: 2025
          month: 6
          day: 15
          hour: 12
        atmosphere:
          model: wyoming_sounding
        """,
    )

    with pytest.raises(ScenarioValidationError) as exc_info:
        load_scenario(yaml_path)

    assert "station" in str(exc_info.value).lower()


# ---------------------------------------------------------------------------
# DEFAULT_UNCERTAINTY sanity check (data contract)
# ---------------------------------------------------------------------------


def test_default_uncertainty_has_all_required_keys():
    """DEFAULT_UNCERTAINTY ships with exactly the six required keys."""
    required = {"mass", "inclination", "heading", "wind_factor", "thrust", "rail_length"}
    assert required == set(DEFAULT_UNCERTAINTY.keys())


def test_default_uncertainty_values():
    """DEFAULT_UNCERTAINTY values match the spec (design section)."""
    assert DEFAULT_UNCERTAINTY["mass"].std == pytest.approx(0.05)
    assert DEFAULT_UNCERTAINTY["mass"].kind == "relative"
    assert DEFAULT_UNCERTAINTY["inclination"].std == pytest.approx(2.0)
    assert DEFAULT_UNCERTAINTY["inclination"].kind == "absolute"
    assert DEFAULT_UNCERTAINTY["heading"].std == pytest.approx(2.0)
    assert DEFAULT_UNCERTAINTY["heading"].kind == "absolute"
    assert DEFAULT_UNCERTAINTY["wind_factor"].std == pytest.approx(0.10)
    assert DEFAULT_UNCERTAINTY["thrust"].std == pytest.approx(0.03)
    assert DEFAULT_UNCERTAINTY["thrust"].kind == "relative"
    assert DEFAULT_UNCERTAINTY["rail_length"].std == pytest.approx(0.05)
    assert DEFAULT_UNCERTAINTY["rail_length"].kind == "relative"
