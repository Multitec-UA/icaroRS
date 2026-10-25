"""Simulation history endpoint.

Routes (all require auth via router-level dependency):
  GET /api/history   — paginated list, reverse-chronological

Req: REQ-05.1, REQ-05.2, REQ-05.3.

Denormalization choice (fork resolved in T-23)
----------------------------------------------
Rocket ``name`` and the export's ``ork_filename`` are denormalized via
``db.get_rocket`` / ``db.get_export`` calls per row (join-on-read), NOT stored
in ``SimRecord`` at save time (join-on-write).

Rationale: the ``SimRecord`` already has ``rocket_id`` and ``export_id`` — the
per-row lookups cost O(n) dict gets in ``InMemoryDb`` (O(1) each) and two
Firestore ``get`` calls per doc in production.  For list sizes capped at 100
this is acceptable.  Storing ``rocket_name`` in ``SimRecord`` would require a
backfill whenever a rocket is renamed (not currently a concern but avoids
coupling).  If profiling shows N+1 at list scale, add
``SimRecord.rocket_name`` as a denormalized cache field and populate it at
save time without breaking the current interface.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from icaro_api.auth import Identity, require_auth
from icaro_api.runs import get_db
from icaro_api.services.db import Db

router = APIRouter(
    tags=["history"],
    dependencies=[Depends(require_auth)],
)

_DEFAULT_LIMIT = 20
_MAX_LIMIT = 100


class SimulationSummary(BaseModel):
    """One simulation as returned by GET /api/history."""

    simulation_id: str
    rocket_id: str
    export_id: str
    name: str
    ork_filename: str | None
    created_at: str
    created_by: str
    status: Literal["done", "error"]
    scenario: dict[str, Any]
    scalars: dict[str, Any]
    warnings: list[str]
    result_prefix: str
    plot_names: list[str]
    has_series: bool


@router.get("/history", response_model=list[SimulationSummary])
def list_history(
    limit: int = _DEFAULT_LIMIT,
    before: datetime | None = None,
    rocket_id: str | None = None,
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> list[dict[str, Any]]:
    """Return a paginated list of simulations in reverse-chronological order.

    Each item includes the denormalized rocket ``name`` and the simulated
    export's ``ork_filename`` (join-on-read — see module docstring).

    Parameters
    ----------
    limit : int
        Maximum number of records (default: 20, max: 100).
    before : datetime | None
        Cursor — return only simulations created before this timestamp.
    rocket_id : str | None
        If given, only the runs of that rocket (any of its exports).

    Satisfies REQ-05.1, REQ-05.2, REQ-05.3.
    """
    effective_limit = min(max(1, limit), _MAX_LIMIT)
    records = db.list_simulations(
        org_id=identity.org_id, limit=effective_limit, before=before, rocket_id=rocket_id
    )

    result = []
    for sim in records:
        # Denormalize rocket name and export filename — O(1) dict gets in
        # InMemoryDb, one Firestore doc get each in production.  Acceptable
        # for list sizes ≤ 100.  Pre-split runs have export_id == "".
        rocket = db.get_rocket(sim.rocket_id, org_id=identity.org_id)
        rocket_name = rocket.name if rocket is not None else ""
        export = db.get_export(sim.export_id, org_id=identity.org_id) if sim.export_id else None
        ork_filename = export.ork_filename if export is not None else None

        # Extract apogee from scalars — expose at top level per REQ-05.2.
        apogee = sim.scalars.get("apogee_m") or sim.scalars.get("apogee")

        result.append(
            {
                "simulation_id": sim.simulation_id,
                "rocket_id": sim.rocket_id,
                "export_id": sim.export_id,
                "name": rocket_name,
                "ork_filename": ork_filename,
                "created_at": sim.created_at.isoformat(),
                "created_by": sim.created_by,
                "status": sim.status,
                "scenario": sim.scenario,
                "scalars": {
                    **sim.scalars,
                    "apogee": apogee,
                },
                "warnings": sim.warnings,
                "result_prefix": sim.result_prefix,
                "plot_names": sim.plot_names,
                "has_series": sim.has_series,
            }
        )

    return result
