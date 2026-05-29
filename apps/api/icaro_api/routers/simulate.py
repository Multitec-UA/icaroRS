"""Simulate endpoint — POST /api/simulate.

Acquires the process-wide lock, runs simulate_from_export, serializes the
Flight object via serialize_flight, and returns the result.

Design §6 (simulate lock), §2 (serialization), §11 (forward-compat run_id).
Spec RG-2.4, AC-RG-2.5, AC-RG-2.6, RG-9.2, ADR-6.
"""

from __future__ import annotations

import warnings as _warnings_module
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from icaro import simulate_from_export
from icaro.scenario import Scenario
from icaro_api.auth import require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.runs import make_run_id
from icaro_api.serialize import serialize_flight
from icaro_api.simulate_lock import _SIMULATE_LOCK

router = APIRouter(
    tags=["simulate"],
    dependencies=[Depends(require_auth)],
)


class SimulateRequest(BaseModel):
    """Request body for POST /api/simulate."""

    export_id: str
    """Path to the export directory (returned by POST /api/convert)."""

    scenario: dict[str, Any]
    """Scenario dict (validated by Scenario.model_validate before use)."""


@router.post("/simulate")
def run_simulate(
    body: SimulateRequest,
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Run a deterministic 6-DOF simulation and return serialized results.

    Workflow:
    1. Validate the scenario dict → 422 on failure (no traceback).
    2. Acquire ``_SIMULATE_LOCK`` (serializes concurrent requests, RG-9.2).
    3. Run ``simulate_from_export`` with warnings capture.
    4. Serialize the Flight via ``serialize_flight``.
    5. Release lock.
    6. Return ``{run_id, scalars, plot_urls, warnings}``.

    ``run_id`` is ALWAYS returned (ADR-6: forward-compat for async upgrade).

    Satisfies RG-2.4, AC-RG-2.5, AC-RG-2.6, RG-9.2.
    """
    from pydantic import ValidationError

    # Validate scenario — 422 if invalid, no traceback.
    try:
        scenario = Scenario.model_validate(body.scenario)
    except ValidationError as exc:
        errors = [
            {
                "loc": list(err.get("loc", [])),
                "field": ".".join(str(p) for p in err.get("loc", []) if p != "__root__"),
                "message": err.get("msg", "Validation error"),
            }
            for err in exc.errors()
        ]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=errors,
        )

    export_dir = Path(body.export_id)
    if not export_dir.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Export directory not found: {body.export_id}",
        )

    run_id = make_run_id()

    # Serialize under lock — protects matplotlib global state (ADR-3).
    with _SIMULATE_LOCK:
        with _warnings_module.catch_warnings(record=True) as captured_w:
            _warnings_module.simplefilter("always")
            flight = simulate_from_export(str(export_dir), scenario=scenario)

        result = serialize_flight(
            flight=flight,
            run_dir=settings.results_dir,
            run_id=run_id,
            captured_warnings=list(captured_w),
        )

    return result
