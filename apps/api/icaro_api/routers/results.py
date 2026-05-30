"""Results endpoints — serve run artifacts.

Routes (all require auth via router-level dependency):
  GET /api/results/{run_id}                   — result.json in job-status shape
  GET /api/results/{run_id}/plots/{name}.png  — serve a plot PNG
  GET /api/results/{run_id}/series            — flight time-series (issue #11)

Design §11 (forward-compat job-status shape), §2 (run dir layout).
Spec RG-2.5, RG-9.7, ADR-6.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from icaro_api.auth import require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.runs import resolve_run_dir

router = APIRouter(
    tags=["results"],
    dependencies=[Depends(require_auth)],
)


@router.get("/results/{run_id}")
def get_result(
    run_id: str,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Return the result for a completed run in forward-compat job-status shape.

    Response shape: ``{run_id, status: "done", result}``

    The shape is designed for forward-compat with an async/polling upgrade
    (ADR-6): when simulate becomes async, this endpoint will return
    ``{run_id, status: "running"|"done"|"error", progress?, result?}`` and
    the client polls — no contract break.

    Returns 404 if the run_id is not found.
    Satisfies RG-2.5, RG-9.7.
    """
    run_dir = resolve_run_dir(settings.results_dir, run_id)
    if run_dir is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )

    result_file = run_dir / "result.json"
    if not result_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Result for run '{run_id}' not found (no result.json).",
        )

    try:
        result = json.loads(result_file.read_text())
    except Exception:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not read result file.",
        )

    # Forward-compat job-status shape (design §11).
    return {
        "run_id": run_id,
        "status": "done",
        "result": result,
    }


@router.get("/results/{run_id}/series")
def get_series(
    run_id: str,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Return the resampled flight time-series for a completed run (issue #11).

    Shape: ``{t, altitude, speed, mach, acceleration, path3d}`` — plain JSON
    arrays sharing one ``t`` axis, written by ``serialize_flight`` at simulate
    time. Powers the interactive 2D charts and the animated 3D trajectory.

    Returns 404 if the run is unknown OR predates this feature (no series.json);
    the client then falls back to the static PNG plots. Additive endpoint — the
    rest of the ``/api`` contract is untouched.
    """
    run_dir = resolve_run_dir(settings.results_dir, run_id)
    if run_dir is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )

    series_file = run_dir / "series.json"
    if not series_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Series for run '{run_id}' not available.",
        )

    try:
        return json.loads(series_file.read_text())
    except Exception:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not read series file.",
        )


@router.get("/results/{run_id}/plots/{name}.png")
def get_plot(
    run_id: str,
    name: str,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    """Serve a plot PNG from the run directory.

    Returns 404 if the run or plot file does not exist.
    Satisfies RG-2.5.
    """
    run_dir = resolve_run_dir(settings.results_dir, run_id)
    if run_dir is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Run '{run_id}' not found.",
        )

    # Sanitise the name — strip any path separators to prevent directory traversal.
    safe_name = Path(name).name
    plot_file = run_dir / f"{safe_name}.png"

    if not plot_file.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Plot '{name}.png' not found for run '{run_id}'.",
        )

    return FileResponse(str(plot_file), media_type="image/png")
