"""Subprocess worker: run ONE Monte Carlo dispersion job in a fresh process.

Why a subprocess (S9)
---------------------
A Monte Carlo run takes minutes (n = 500 ≈ 3–4 min serial) and is CPU-bound.
Running it inside the API process would hold the GIL against every other
request and share matplotlib/rocketpy global state with ``/simulate``. A
short-lived child process keeps the API responsive and isolates the run;
``services/montecarlo_jobs.py`` launches it, one at a time, and follows its
progress through the line counts of the NDJSON output files.

Invocation
----------
    python -m icaro_api.services.montecarlo_worker \\
        --export-dir D --scenario-json F --n N --output-prefix P --result-json R

``F`` holds the scenario JSON (or ``null`` for icaro defaults). On success the
``MonteCarloResult.to_dict()`` payload is written to ``R`` and the process
exits 0. On failure the error message goes to stderr and the process exits 1.
Nothing is printed otherwise.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

EXIT_OK = 0
EXIT_ERROR = 1


def _parse(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="montecarlo_worker")
    parser.add_argument("--export-dir", required=True)
    parser.add_argument("--scenario-json", required=True)
    parser.add_argument("--n", required=True, type=int)
    parser.add_argument("--output-prefix", required=True)
    parser.add_argument("--result-json", required=True)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    """Run the job described by *argv* (without the program name)."""
    args = _parse(argv)
    try:
        import icaro
        from icaro.scenario import Scenario

        raw = json.loads(Path(args.scenario_json).read_text(encoding="utf-8"))
        scenario = None if raw is None else Scenario.model_validate(raw)
        Path(args.output_prefix).parent.mkdir(parents=True, exist_ok=True)
        result = icaro.run_monte_carlo(
            args.export_dir,
            scenario,
            args.n,
            args.output_prefix,
            parallel=False,
        )
        Path(args.result_json).write_text(json.dumps(result.to_dict()), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001 — any failure becomes exit 1 + stderr
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return EXIT_ERROR
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover — exercised via subprocess
    sys.exit(main(sys.argv[1:]))
