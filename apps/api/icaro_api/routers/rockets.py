"""Rockets endpoints — a rocket groups the ``.ork`` files (exports) a team uploads.

Routes (all require auth via router-level dependency):
  GET /api/rockets                 — paginated list, reverse-chronological
  GET /api/rockets/{rocket_id}     — rocket + its exports, newest first

Manifests live on the export: ``GET /api/exports/{export_id}``.

Req: REQ-04.1 (reverse-chrono), REQ-04.3 (pagination).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from icaro_api.auth import Identity, require_auth
from icaro_api.routers.exports import ExportSummary, export_summary
from icaro_api.runs import get_db
from icaro_api.services.db import Db, RocketRecord

router = APIRouter(
    tags=["rockets"],
    dependencies=[Depends(require_auth)],
)

_DEFAULT_LIMIT = 20
_MAX_LIMIT = 100
_MAX_EXPORTS_PER_ROCKET = 100


class RocketSummary(BaseModel):
    """One rocket as returned by GET /api/rockets."""

    rocket_id: str
    name: str
    created_at: str
    created_by: str


class RocketDetail(RocketSummary):
    """Response body for GET /api/rockets/{rocket_id} — the rocket plus its exports."""

    exports: list[ExportSummary]


def rocket_summary(rec: RocketRecord) -> dict[str, Any]:
    return {
        "rocket_id": rec.rocket_id,
        "name": rec.name,
        "created_at": rec.created_at.isoformat(),
        "created_by": rec.created_by,
    }


@router.get("/rockets", response_model=list[RocketSummary])
def list_rockets(
    limit: int = _DEFAULT_LIMIT,
    before: datetime | None = None,
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> list[dict[str, Any]]:
    """Return a paginated list of the org's rockets in reverse-chronological order.

    Parameters
    ----------
    limit : int
        Maximum number of records (default: 20, max: 100).
    before : datetime | None
        Cursor — return only rockets created before this timestamp (ISO 8601).

    Satisfies REQ-04.1, REQ-04.3.
    """
    effective_limit = min(max(1, limit), _MAX_LIMIT)
    records = db.list_rockets(org_id=identity.org_id, limit=effective_limit, before=before)
    return [rocket_summary(r) for r in records]


@router.get("/rockets/{rocket_id}", response_model=RocketDetail)
def get_rocket(
    rocket_id: str,
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Return the rocket and its exports (newest first).

    Both lookups are scoped to the caller's org in the ``Db`` layer, so a
    rocket_id that exists in another org is indistinguishable from a missing one.
    Returns 404 if the rocket_id is not found OR not owned by the caller's org.
    """
    record = db.get_rocket(rocket_id, org_id=identity.org_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Rocket '{rocket_id}' not found.",
        )
    exports = db.list_exports(
        org_id=identity.org_id, limit=_MAX_EXPORTS_PER_ROCKET, rocket_id=rocket_id
    )
    return {**rocket_summary(record), "exports": [export_summary(e) for e in exports]}
