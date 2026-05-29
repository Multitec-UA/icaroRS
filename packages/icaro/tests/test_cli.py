"""Tests for the icaro CLI — thin delivery layer.

Tests use typer's CliRunner so no subprocess or real simulation is needed.
The icaro domain use-cases are monkeypatched to return stub objects.

Coverage targets:
- SIM-1: no --scenario → exits zero, standard_atmosphere path
- SIM-4: --scenario with rail.inclination override → correct inclination used
- REQ-SIM-07: zero atmosphere/rail logic in CLI body (verified by confirming
  the CLI delegates entirely to simulate_from_export)

TDD: tests written BEFORE the --scenario flag is added to the CLI.
"""

from __future__ import annotations

import textwrap
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from typer.testing import CliRunner

from icaro_cli.main import app


runner = CliRunner()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def write_scenario(tmp_path: Path, content: str) -> Path:
    p = tmp_path / "scenario.yaml"
    p.write_text(textwrap.dedent(content))
    return p


def minimal_scenario_yaml(model: str = "standard_atmosphere") -> str:
    return f"""
    name: test_scenario
    site:
      latitude: 38.37
      longitude: -0.58
    atmosphere:
      model: {model}
    rail:
      inclination: 80.0
    """


# ---------------------------------------------------------------------------
# SIM-1 — Backward compat: no --scenario exits zero
# ---------------------------------------------------------------------------


def test_sim1_no_scenario_exits_zero(tmp_path):
    """SIM-1: simulate without --scenario exits zero (backward compat)."""
    export_dir = tmp_path / "export"
    export_dir.mkdir()

    mock_flight = MagicMock()
    mock_flight.info = MagicMock()

    with patch("icaro_cli.main.simulate_from_export", return_value=mock_flight):
        result = runner.invoke(app, ["simulate", str(export_dir)])

    assert result.exit_code == 0, f"Expected exit code 0, got {result.exit_code}: {result.output}"
    mock_flight.info.assert_called_once()


# ---------------------------------------------------------------------------
# SIM-4 — --scenario with rail.inclination override
# ---------------------------------------------------------------------------


def test_sim4_scenario_flag_passed_to_use_case(tmp_path):
    """SIM-4: --scenario flag causes load_scenario + simulate_from_export(scenario=...)."""
    export_dir = tmp_path / "export"
    export_dir.mkdir()

    scenario_path = write_scenario(tmp_path, minimal_scenario_yaml())

    mock_flight = MagicMock()
    mock_flight.info = MagicMock()
    mock_scenario = MagicMock()

    with (
        patch("icaro_cli.main.load_scenario", return_value=mock_scenario) as mock_load,
        patch("icaro_cli.main.simulate_from_export", return_value=mock_flight) as mock_sim,
    ):
        result = runner.invoke(
            app,
            ["simulate", str(export_dir), "--scenario", str(scenario_path)],
        )

    assert result.exit_code == 0, f"Unexpected error: {result.output}"
    # load_scenario must be called with the provided path.
    mock_load.assert_called_once()
    loaded_path = mock_load.call_args[0][0]
    assert Path(loaded_path) == scenario_path

    # simulate_from_export must be called with the scenario kwarg.
    mock_sim.assert_called_once()
    call_kwargs = mock_sim.call_args
    # Either positional or keyword 'scenario' argument.
    if call_kwargs[1]:
        assert call_kwargs[1].get("scenario") is mock_scenario
    else:
        # positional: (export_dir, scenario)
        assert call_kwargs[0][1] is mock_scenario


# ---------------------------------------------------------------------------
# REQ-SIM-07 — No business logic in CLI
# ---------------------------------------------------------------------------


def test_req_sim07_no_atmosphere_logic_in_cli():
    """REQ-SIM-07: CLI module must not contain atmosphere selection logic.

    This is a static assertion: we import the CLI module source and assert
    certain forbidden API calls are absent (docstring mentions are fine).
    """
    import icaro_cli.main as cli_module

    source_path = Path(cli_module.__file__)
    source = source_path.read_text()

    # These are CALL patterns — actual code, not just words in comments/docs.
    # A mention of "standard_atmosphere" in a help string is fine; a call to
    # set_atmospheric_model() or a direct rocketpy import is not.
    forbidden_patterns = [
        "set_atmospheric_model",
        "import rocketpy",
        "from rocketpy",
        "Environment(",
        "SolidMotor(",
        "Flight(",
    ]
    for pattern in forbidden_patterns:
        assert pattern not in source, (
            f"REQ-SIM-07 violation: CLI contains forbidden pattern '{pattern}'. "
            "Atmosphere/rocketpy logic must stay in icaro use-cases."
        )
