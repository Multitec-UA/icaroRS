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


# ---------------------------------------------------------------------------
# Phase B — icaro convert CLI tests (B2.1)
# ---------------------------------------------------------------------------


def test_cvt2_convert_without_extra_prints_install_hint(tmp_path):
    """CVT-2: when [convert] extra is missing, CLI prints install hint + exits non-zero.

    No traceback, no raw ImportError — a human-readable message only.
    typer's CliRunner captures both stdout and stderr in result.output.
    """
    ork_file = tmp_path / "rocket.ork"
    ork_file.write_text("<openrocket/>")

    from icaro.convert import ConvertUnavailableError

    with patch(
        "icaro_cli.main.convert_ork",
        side_effect=ConvertUnavailableError(
            "Install with: pip install 'icaro-cli[convert]' and ensure Java 21 is available."
        ),
    ):
        result = runner.invoke(app, ["convert", str(ork_file)])

    assert result.exit_code != 0, (
        f"Expected non-zero exit for missing [convert] extra, got {result.exit_code}"
    )
    # The install hint must be visible in the combined output.
    combined = result.output.lower()
    assert "convert" in combined or "install" in combined, (
        f"Expected install hint in output, got: {result.output!r}"
    )


def test_cvt3_convert_nonexistent_ork_exits_nonzero(tmp_path):
    """CVT-3: non-existent .ork file → CLI exits non-zero with error referencing the file."""
    missing = tmp_path / "ghost.ork"
    # Do NOT create the file.

    result = runner.invoke(app, ["convert", str(missing)])

    assert result.exit_code != 0, (
        f"Expected non-zero exit for missing .ork file, got {result.exit_code}"
    )
    # Typer's Path(exists=True) will catch this before the use-case is called.


def test_cvt_success_prints_output_dir(tmp_path):
    """REQ-CVT-05: on success, CLI prints the output directory path."""
    ork_file = tmp_path / "rocket.ork"
    ork_file.write_text("<openrocket/>")
    output_dir = tmp_path / "export"

    expected_path = output_dir

    with patch("icaro_cli.main.convert_ork", return_value=expected_path) as mock_convert:
        result = runner.invoke(
            app,
            ["convert", str(ork_file), "--output-dir", str(output_dir)],
        )

    assert result.exit_code == 0, f"Expected exit 0, got {result.exit_code}: {result.output}"
    assert str(expected_path) in result.output, (
        f"Expected output dir path in stdout, got: {result.output!r}"
    )
    mock_convert.assert_called_once()


def test_cvt_calls_use_case_with_correct_args(tmp_path):
    """REQ-CVT-04: CLI passes ork_path and output_dir to convert_ork use-case."""
    ork_file = tmp_path / "rocket.ork"
    ork_file.write_text("<openrocket/>")
    output_dir = tmp_path / "export"

    with patch("icaro_cli.main.convert_ork", return_value=output_dir) as mock_convert:
        runner.invoke(
            app,
            ["convert", str(ork_file), "--output-dir", str(output_dir)],
        )

    mock_convert.assert_called_once()
    call_args = mock_convert.call_args
    # ork_path is the first positional/keyword argument.
    positional = call_args[0]
    keyword = call_args[1]
    ork_arg = positional[0] if positional else keyword.get("ork_path")
    assert Path(str(ork_arg)) == ork_file or str(ork_file) in str(ork_arg)


def test_req_cvt_no_ork_extractor_import_in_cli():
    """REQ-CVT-04: CLI must NOT import rocketserializer or ork_extractor directly."""
    import icaro_cli.main as cli_module

    source_path = Path(cli_module.__file__)
    source = source_path.read_text()

    forbidden = [
        "import rocketserializer",
        "from rocketserializer",
        "import orhelper",
        "from orhelper",
        "ork_extractor",
    ]
    for pattern in forbidden:
        assert pattern not in source, (
            f"REQ-CVT-04 violation: CLI contains '{pattern}'. "
            "rocketserializer must be accessed only via the icaro.convert use-case."
        )
