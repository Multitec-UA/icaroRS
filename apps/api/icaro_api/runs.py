"""Run-id scheme and run-directory helpers.

Every simulate call is assigned a unique ``run_id`` that:

* Is URL-safe (used as a path segment in ``/api/results/{run_id}/...``).
* Is chronologically sortable (timestamp prefix).
* Is collision-safe (short UUID suffix).
* Is forward-compatible with the Monte Carlo job model (NDJSON output drops
  into the same directory structure, per RG-9.7 / ADR-6).

Usage
-----
>>> from icaro_api.runs import make_run_id, make_run_dir
>>> run_id = make_run_id()
>>> run_dir = make_run_dir(base_dir, run_id)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from pathlib import Path


def make_run_id() -> str:
    """Generate a new run id: ``{utc-timestamp}-{short-uuid}``.

    Returns
    -------
    str
        E.g. ``20260529T183000Z-a1b2c3d4``
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    short = uuid.uuid4().hex[:8]
    return f"{ts}-{short}"


def make_run_dir(base_dir: Path, run_id: str) -> Path:
    """Create and return ``{base_dir}/{run_id}/``.

    Parameters
    ----------
    base_dir : Path
        Root results directory (from ``Settings.results_dir``).
    run_id : str
        Unique run identifier (from :func:`make_run_id`).

    Returns
    -------
    Path
        The newly created directory path.
    """
    run_dir = base_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def resolve_run_dir(base_dir: Path, run_id: str) -> Path | None:
    """Return the run directory if it exists, else ``None``.

    Parameters
    ----------
    base_dir : Path
        Root results directory.
    run_id : str
        Run id to look up.

    Returns
    -------
    Path | None
    """
    run_dir = base_dir / run_id
    return run_dir if run_dir.is_dir() else None
