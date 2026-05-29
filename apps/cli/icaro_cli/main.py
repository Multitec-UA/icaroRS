"""icaro CLI — a thin delivery layer over the icaro domain.

Responsibilities: parse input, call a domain use-case, present the result.
There is deliberately NO simulation logic here — that lives in the ``icaro``
package so the (future) API and web surfaces can reuse the exact same code.
"""

from pathlib import Path

import typer

from icaro import simulate_from_export

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
    working and there is room for future subcommands (serialize, monte-carlo).
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
) -> None:
    """Run a 6-DOF flight simulation from a RocketSerializer export."""
    typer.echo(f"Simulating rocket from: {export_dir}")
    flight = simulate_from_export(export_dir)
    flight.info()


if __name__ == "__main__":
    app()
