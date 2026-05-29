"""icaro CLI — a thin delivery layer over the icaro domain.

Responsibilities: parse input, call a domain use-case, present the result.
There is deliberately NO simulation logic here — that lives in the ``icaro``
package so the (future) API and web surfaces can reuse the exact same code.

NFN-2 INTERNET NOTE: When using --scenario with atmosphere.model: forecast,
an active internet connection is required at simulation time to fetch GFS
data from UCAR THREDDS.

NFN-3 GFS WINDOW NOTE: GFS data is available from approximately the current
time to ~16 days ahead. Dates outside this window will trigger an automatic
fallback to standard_atmosphere (with a warning message).
"""

from pathlib import Path
from typing import Optional

import typer

from icaro import load_scenario, simulate_from_export

app = typer.Typer(
    help="icaroRS rocket simulation toolkit.",
    no_args_is_help=True,
    add_completion=False,
)


@app.callback()
def _root() -> None:
    """icaroRS rocket simulation toolkit.

    A no-op root callback. Its only job is to stop Typer from collapsing a
    single-command app into a top-level command, so `icaro simulate ...` keeps
    working and there is room for future subcommands (convert, mc, sensitivity,
    compare).
    """


@app.command()
def simulate(
    export_dir: Path = typer.Argument(
        ...,
        exists=True,
        file_okay=False,
        dir_okay=True,
        readable=True,
        help="RocketSerializer export directory (parameters.json + CSVs).",
    ),
    scenario: Optional[Path] = typer.Option(
        None,
        "--scenario",
        "-s",
        help=(
            "Path to a scenario YAML file. Provides site, date, atmosphere model "
            "(forecast/standard_atmosphere/etc.) and optional rail overrides. "
            "When omitted, standard_atmosphere is used (backward-compatible mode). "
            "NOTE: atmosphere.model: forecast requires internet (GFS via UCAR THREDDS). "
            "Dates outside the ~16-day GFS window fall back to standard_atmosphere automatically."
        ),
    ),
    export: Optional[Path] = typer.Option(
        None,
        "--export",
        "-e",
        help="Write a JSON result summary to this directory.",
    ),
    report: bool = typer.Option(
        False,
        "--report",
        help="Show full RocketPy report (plots and prints) after simulation.",
    ),
) -> None:
    """Run a 6-DOF flight simulation from a RocketSerializer export.

    Without --scenario: uses standard_atmosphere (backward-compatible).
    With --scenario: uses the atmosphere model, site, and rail overrides
    from the YAML file.
    """
    typer.echo(f"Simulating rocket from: {export_dir}")

    # Load scenario if provided — zero atmosphere/rail logic here.
    loaded_scenario = None
    if scenario is not None:
        loaded_scenario = load_scenario(scenario)
        typer.echo(f"Using scenario: {loaded_scenario.name} ({scenario})")

    flight = simulate_from_export(export_dir, scenario=loaded_scenario)
    flight.info()

    if report:
        flight.plots.trajectory_3d()
        flight.prints.all()


if __name__ == "__main__":
    app()
