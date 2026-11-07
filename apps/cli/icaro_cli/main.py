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

import contextlib
import io
from pathlib import Path
from typing import Optional

import typer

from icaro import (
    ConvertUnavailableError,
    WindMarginResult,
    convert_ork,
    load_scenario,
    run_monte_carlo,
    simulate_from_export,
)

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

    # Static margin (RocketPy) next to the OpenRocket-equivalent one, which
    # adds body lift at the angle of attack the wind causes at rail exit.
    margin = getattr(flight, "wind_stability", None)
    if isinstance(margin, WindMarginResult):
        typer.echo(
            f"Stability off the rail: {margin.static_cal:.2f} cal static · "
            f"{margin.wind_cal:.2f} cal with wind "
            f"(AoA {margin.angle_of_attack_deg:.1f}°)"
        )

    if report:
        flight.plots.trajectory_3d()
        flight.prints.all()


@app.command()
def convert(
    ork_file: Path = typer.Argument(
        ...,
        exists=True,
        file_okay=True,
        dir_okay=False,
        readable=True,
        help="Path to the OpenRocket .ork file to convert.",
    ),
    output_dir: Optional[Path] = typer.Option(
        None,
        "--output-dir",
        "-o",
        help=(
            "Destination directory for the export files "
            "(parameters.json, thrust_source.csv, drag_curve.csv). "
            "Defaults to a directory named after the .ork file stem in the "
            "current working directory."
        ),
    ),
    ork_jar: Optional[Path] = typer.Option(
        None,
        "--ork-jar",
        help=(
            "Path to the OpenRocket .jar file. "
            "When omitted, searches the current directory for OpenRocket*.jar. "
            "NFN-4: requires Java 21+ installed on your system."
        ),
    ),
) -> None:
    """Convert an OpenRocket .ork file to a RocketSerializer export directory.

    The export directory contains parameters.json, thrust_source.csv and
    drag_curve.csv — ready for use with 'icaro simulate'.

    NFN-4: requires Java 21+ and the [convert] optional extra:
        pip install 'icaro-cli[convert]'
    """
    try:
        result = convert_ork(ork_path=ork_file, output_dir=output_dir, ork_jar=ork_jar)
    except ConvertUnavailableError as exc:
        typer.echo(str(exc), err=True)
        raise typer.Exit(code=1)

    typer.echo(str(result))


@app.command()
def mc(
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
        exists=True,
        dir_okay=False,
        readable=True,
        help=(
            "Path to a scenario YAML file. Its 'uncertainty' block sets the "
            "dispersion budget; without it (or without --scenario) the default "
            "budget applies."
        ),
    ),
    n: int = typer.Option(
        ...,
        "-n",
        "--n",
        min=1,
        help="Number of flights to simulate.",
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help=(
            "Output file prefix. Writes PREFIX.inputs.txt, PREFIX.outputs.txt, "
            "PREFIX.errors.txt and PREFIX.kml. Defaults to ./<scenario name>, "
            "or ./montecarlo without --scenario."
        ),
    ),
    parallel: bool = typer.Option(
        False,
        "--parallel",
        help="Run flights in parallel worker processes.",
    ),
    workers: Optional[int] = typer.Option(
        None,
        "--workers",
        min=2,
        help="Number of worker processes (requires --parallel).",
    ),
) -> None:
    """Run a Monte Carlo dispersion: N stochastic flights within the
    scenario's uncertainty budget.

    Prints the apogee distribution and the output file paths, including the
    landing ellipses as KML (written when at least 3 flights succeed). Expect
    minutes of runtime; live progress goes to stderr. Failed flights do not
    abort the run; their inputs land in PREFIX.errors.txt. Exits 1 when no
    flight succeeds.
    """
    if workers is not None and not parallel:
        raise typer.BadParameter("--workers requires --parallel.", param_hint="'--workers'")

    loaded_scenario = load_scenario(scenario) if scenario is not None else None
    if output is None:
        name = loaded_scenario.name if loaded_scenario is not None else "montecarlo"
        output = Path(".") / name

    def show_progress(done: int, total: int) -> None:
        typer.echo(f"\r  {done}/{total} flights", err=True, nl=False)

    typer.echo(f"Running {n} Monte Carlo flights from: {export_dir}", err=True)
    # RocketPy prints its own progress to stdout; keep it out of our output.
    with contextlib.redirect_stdout(io.StringIO()):
        result = run_monte_carlo(
            export_dir,
            loaded_scenario,
            n,
            output,
            parallel=parallel,
            workers=workers,
            on_progress=show_progress,
        )
    typer.echo("", err=True)

    typer.echo(
        f"Flights: {result.n_requested} attempted, {result.n_succeeded} succeeded, "
        f"{result.n_failed} failed"
    )
    stats = result.apogee_stats
    if stats is None:
        typer.echo("Apogee AGL: no successful flights")
    else:
        typer.echo(
            f"Apogee AGL: {stats.mean:.1f} ± {stats.std:.1f} m "
            f"(p5 {stats.p5:.1f}, p50 {stats.p50:.1f}, p95 {stats.p95:.1f})"
        )
    typer.echo("Files:")
    typer.echo(f"  Inputs:  {result.inputs_path}")
    typer.echo(f"  Outputs: {result.outputs_path}")
    typer.echo(f"  Errors:  {result.errors_path}")
    if result.kml_path is not None:
        typer.echo(f"  Landing ellipses (KML): {result.kml_path}")

    if result.n_succeeded == 0:
        typer.echo(f"No flight succeeded; see {result.errors_path}", err=True)
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
