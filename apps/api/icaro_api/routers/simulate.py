"""Simulate endpoint — POST /api/simulate.

Acquires the process-wide lock, runs simulate_from_export, serializes the
Flight object via serialize_flight, uploads results to Storage, and saves a
SimRecord to Db — all after _SIMULATE_LOCK is released.

Workflow:
1. Validate the scenario dict → 422 on failure.
2. Resolve export_id to its RocketRecord (org-owned, 404 otherwise) and
   download its export_prefix via Storage.download_dir into a temp dir
   (pre-lock).
3. Acquire _SIMULATE_LOCK.
4. Run simulate_from_export + serialize_flight under lock.
5. Release lock.
6. Upload results via Storage.upload_dir (AFTER lock release — REQ-07.1).
7. Save SimRecord via Db (AFTER lock release — REQ-07.3).
8. Return {run_id, scalars, plot_urls, warnings}.

Design §6 (simulate lock), §2 (serialization), §11 (forward-compat run_id).
Spec REQ-01.3, REQ-02.2, REQ-02.3, REQ-03.2, REQ-07.1, REQ-07.3.
"""

from __future__ import annotations

import logging
import tempfile
import warnings as _warnings_module
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from icaro import simulate_from_export
from icaro.scenario import Scenario
from icaro_api.auth import Identity, require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.runs import get_db, get_storage, make_run_id
from icaro_api.serialize import serialize_flight
from icaro_api.services.db import Db, SimRecord
from icaro_api.services.storage import Storage
from icaro_api.simulate_lock import _SIMULATE_LOCK

logger = logging.getLogger("icaro_api.simulate")

router = APIRouter(
    tags=["simulate"],
    dependencies=[Depends(require_auth)],
)


class SimulateRequest(BaseModel):
    """Request body for POST /api/simulate."""

    export_id: str
    """Logical rocket id returned by POST /api/convert (opaque string, not a path)."""

    scenario: dict[str, Any]
    """Scenario dict (validated by Scenario.model_validate before use)."""


class SimulateResult(BaseModel):
    """Response body for POST /api/simulate."""

    run_id: str
    scalars: dict[str, float]
    plot_urls: list[str]
    warnings: list[str]


@router.post("/simulate", response_model=SimulateResult)
def run_simulate(
    body: SimulateRequest,
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Run a deterministic 6-DOF simulation and return serialized results.

    Satisfies REQ-01.3, REQ-02.2, REQ-02.3, REQ-03.2, REQ-07.1, REQ-07.3,
    RG-2.4, AC-RG-2.5, AC-RG-2.6, RG-9.2, ADR-6.
    """
    from pydantic import ValidationError

    # --- 1. Validate scenario — 422 if invalid, no traceback ---
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

    # --- 2. Resolve export artifacts via Storage seam (pre-lock) ---
    # REQ-01.3: NO Path(export_id).exists() — the storage seam is authoritative.
    # Issue #45: export_prefix is NEVER reconstructed — it is read from the
    # RocketRecord, which is the only source of truth for where an export
    # actually lives (old flat layout or new org-scoped layout). This also
    # gives export resolution the same cross-org 404 as results.py (#44):
    # an export_id that exists but belongs to another org is indistinguishable
    # from one that doesn't exist at all.
    run_id = make_run_id()
    rocket = db.get_rocket(body.export_id, org_id=identity.org_id)
    if rocket is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Rocket '{body.export_id}' not found.",
        )
    export_prefix = rocket.export_prefix

    with tempfile.TemporaryDirectory() as tmp_str:
        tmp_export = Path(tmp_str) / "export"
        tmp_export.mkdir()
        storage.download_dir(export_prefix, tmp_export)

        # --- 3–4. Simulate + serialize under lock (protects matplotlib state) ---
        try:
            with _SIMULATE_LOCK:
                with _warnings_module.catch_warnings(record=True) as captured_w:
                    _warnings_module.simplefilter("always")
                    flight = simulate_from_export(str(tmp_export), scenario=scenario)

                result = serialize_flight(
                    flight=flight,
                    run_dir=settings.results_dir,
                    run_id=run_id,
                    captured_warnings=list(captured_w),
                )
        except Exception as sim_exc:  # noqa: BLE001
            # REQ-03.2 failure path: record an error SimRecord even when simulation fails.
            error_rec = SimRecord(
                simulation_id=run_id,
                rocket_id=body.export_id,
                scenario=body.scenario,
                created_at=datetime.now(timezone.utc),
                created_by=identity.user_id,
                org_id=identity.org_id,
                status="error",
                scalars={},
                warnings=[str(sim_exc)],
                result_prefix=f"orgs/{identity.org_id}/results/{run_id}/",
                plot_names=[],
                has_series=False,
                artifact_refs={},
            )
            try:
                db.save_simulation(error_rec, org_id=identity.org_id)
            except Exception:  # noqa: BLE001
                logger.error(
                    "Failed to save error SimRecord for run_id=%s",
                    run_id,
                    exc_info=True,
                )
            raise
        # --- 5. Lock released here ---

    # --- 6. Upload simulation results AFTER lock release (REQ-07.1) ---
    # Org-scoped key (issue #45) — result_prefix is persisted on the record
    # and is the only thing any reader (routers/results.py) derives a key from.
    result_prefix = f"orgs/{identity.org_id}/results/{run_id}/"
    result_dir = settings.results_dir / run_id
    try:
        storage.upload_dir(result_prefix, result_dir)
    except Exception:  # noqa: BLE001 — persistence failure must not block response (REQ-07.4)
        logger.error(
            "Failed to upload simulation results for run_id=%s to storage prefix=%s",
            run_id,
            result_prefix,
            exc_info=True,
        )

    # --- 7. Persist simulation metadata to Db AFTER lock release (REQ-07.3) ---
    plot_names = [url.rsplit("/", 1)[-1] for url in result.get("plot_urls", [])]
    has_series = (settings.results_dir / run_id / "series.json").exists()
    artifact_refs: dict[str, str] = {
        "result_json": f"{result_prefix}result.json",
        "series_json": f"{result_prefix}series.json",
    }
    for name in plot_names:
        artifact_refs[name] = f"{result_prefix}{name}"

    sim_rec = SimRecord(
        simulation_id=run_id,
        rocket_id=body.export_id,
        scenario=body.scenario,
        created_at=datetime.now(timezone.utc),
        created_by=identity.user_id,
        org_id=identity.org_id,
        status="done",
        scalars=result.get("scalars", {}),
        warnings=result.get("warnings", []),
        result_prefix=result_prefix,
        plot_names=plot_names,
        has_series=has_series,
        artifact_refs=artifact_refs,
    )
    try:
        db.save_simulation(sim_rec, org_id=identity.org_id)
    except Exception:  # noqa: BLE001 — db failure must not block response (REQ-07.4)
        logger.error(
            "Failed to save simulation record for run_id=%s",
            run_id,
            exc_info=True,
        )

    # --- 8. Return result (run_id always present — ADR-6) ---
    return result
