"""Saved rockets endpoints — list and detail.

Routes (all require auth via router-level dependency):
  GET /api/rockets                 — paginated list, reverse-chronological
  GET /api/rockets/{rocket_id}     — full rocket record including manifest + gcs_ref

Req: REQ-04.1 (reverse-chrono), REQ-04.2 (list fields), REQ-04.3 (pagination),
     REQ-04.4 (detail with manifest + gcs_ref).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status

from icaro_api.auth import require_auth
from icaro_api.runs import get_db
from icaro_api.services.db import Db

router = APIRouter(
    tags=["rockets"],
    dependencies=[Depends(require_auth)],
)

_DEFAULT_LIMIT = 20
_MAX_LIMIT = 100


@router.get("/rockets")
def list_rockets(
    limit: int = _DEFAULT_LIMIT,
    before: datetime | None = None,
    db: Db = Depends(get_db),
) -> list[dict[str, Any]]:
    """Return a paginated list of saved rockets in reverse-chronological order.

    Parameters
    ----------
    limit : int
        Maximum number of records (default: 20, max: 100).
    before : datetime | None
        Cursor — return only rockets created before this timestamp (ISO 8601).

    Satisfies REQ-04.1, REQ-04.2, REQ-04.3.
    """
    effective_limit = min(max(1, limit), _MAX_LIMIT)
    records = db.list_rockets(limit=effective_limit, before=before)

    return [
        {
            "rocket_id": r.rocket_id,
            "name": r.name,
            "created_at": r.created_at.isoformat(),
            "created_by": r.created_by,
            "export_prefix": r.export_prefix,
            "gcs_ref": r.gcs_ref,
            "ork_filename": r.ork_filename,
            "has_source_ork": r.has_source_ork,
        }
        for r in records
    ]


@router.get("/rockets/{rocket_id}")
def get_rocket(
    rocket_id: str,
    db: Db = Depends(get_db),
) -> dict[str, Any]:
    """Return the full rocket record including manifest and gcs_ref.

    Returns 404 if the rocket_id is not found.
    Satisfies REQ-04.4.
    """
    record = db.get_rocket(rocket_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Rocket '{rocket_id}' not found.",
        )

    return {
        "rocket_id": record.rocket_id,
        "name": record.name,
        "created_at": record.created_at.isoformat(),
        "created_by": record.created_by,
        "export_prefix": record.export_prefix,
        "manifest": record.manifest,
        "gcs_ref": record.gcs_ref,
        "ork_filename": record.ork_filename,
        "has_source_ork": record.has_source_ork,
    }
