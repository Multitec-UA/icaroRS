"""Subprocess worker: run ONE OpenRocket conversion in a fresh process.

Why a subprocess (ADR — convert isolation)
-------------------------------------------
``jpype`` can only start a JVM **once per process**, and ``orhelper`` shuts the
JVM down after each conversion.  In a long-lived server that means only the
FIRST ``POST /api/convert`` would ever succeed — the second raises
``OSError: JVM cannot be restarted``.  Running each conversion in its own
short-lived process gives every conversion a brand-new JVM, so conversions are
unlimited.  This is the edge/runtime concern the design's forward path
anticipated; ``icaro.convert_ork`` stays pure and process-agnostic.

Invocation
----------
    python -m icaro_api.services.convert_worker <ork_path> <output_dir> <result_path> [<ork_jar>]

The outcome is written as JSON to ``<result_path>`` (never to stdout, which the
JVM may pollute):

    {"status": "ok",          "export_dir": "/abs/path"}
    {"status": "unavailable", "hint": "<verbatim install hint>"}
    {"status": "error",       "message": "<reason>"}

The process exit code mirrors the status (0 ok, 3 unavailable, 1 error) as a
defence-in-depth signal for the parent.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_UNAVAILABLE = 3


def run_conversion(
    ork_path: str | Path,
    output_dir: str | Path,
    ork_jar: str | Path | None,
) -> dict[str, Any]:
    """Run a single conversion and return an outcome dict.

    Pure mapping layer (no process/IO of its own beyond ``convert_ork``):
    unit-testable by monkeypatching ``convert_ork``.

    Returns one of:
      ``{"status": "ok", "export_dir": str}``
      ``{"status": "unavailable", "hint": str}``
      ``{"status": "error", "message": str}``
    """
    try:
        from icaro import convert_ork
        from icaro.convert import ConvertUnavailableError
    except Exception as exc:  # noqa: BLE001 — import-time failure is an error outcome
        return {"status": "error", "message": f"could not import converter: {exc}"}

    try:
        export_dir = convert_ork(
            ork_path=Path(ork_path),
            output_dir=Path(output_dir),
            ork_jar=Path(ork_jar) if ork_jar else None,
        )
        return {"status": "ok", "export_dir": str(export_dir)}
    except ConvertUnavailableError as exc:
        return {"status": "unavailable", "hint": str(exc)}
    except Exception as exc:  # noqa: BLE001 — any engine fault becomes an error outcome
        return {"status": "error", "message": str(exc)}


def main(argv: list[str]) -> int:
    """CLI entry: parse args, run the conversion, write the outcome JSON."""
    if len(argv) < 4:
        return EXIT_ERROR
    ork_path, output_dir, result_path = argv[1], argv[2], argv[3]
    ork_jar = argv[4] if len(argv) > 4 and argv[4] else None

    outcome = run_conversion(ork_path, output_dir, ork_jar)
    Path(result_path).write_text(json.dumps(outcome), encoding="utf-8")

    status = outcome.get("status")
    if status == "ok":
        return EXIT_OK
    if status == "unavailable":
        return EXIT_UNAVAILABLE
    return EXIT_ERROR


if __name__ == "__main__":  # pragma: no cover — exercised via subprocess
    sys.exit(main(sys.argv))
