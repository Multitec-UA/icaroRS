"""Saved rockets endpoints — list and detail.

Routes (all require auth via router-level dependency):
  GET /api/rockets                 — paginated list, reverse-chronological
  GET /api/rockets/{rocket_id}     — full rocket record including manifest + gcs_ref

Req: REQ-04.1 (reverse-chrono), REQ-04.2 (list fields), REQ-04.3 (pagination),
     REQ-04.4 (detail with manifest + gcs_ref).
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from icaro_api.auth import Identity, require_auth
from icaro_api.runs import get_db, get_storage
from icaro_api.services.db import Db
from icaro_api.services.storage import Storage

router = APIRouter(
    tags=["rockets"],
    dependencies=[Depends(require_auth)],
)

_DEFAULT_LIMIT = 20
_MAX_LIMIT = 100


class RocketSummary(BaseModel):
    """One rocket as returned by GET /api/rockets."""

    rocket_id: str
    name: str
    created_at: str
    created_by: str
    export_prefix: str
    gcs_ref: str
    ork_filename: str | None
    has_source_ork: bool


class RocketDetail(RocketSummary):
    """Response body for GET /api/rockets/{rocket_id} — a RocketSummary plus its manifest."""

    manifest: dict[str, Any]


@router.get("/rockets", response_model=list[RocketSummary])
def list_rockets(
    limit: int = _DEFAULT_LIMIT,
    before: datetime | None = None,
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
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
    records = db.list_rockets(org_id=identity.org_id, limit=effective_limit, before=before)

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


@router.get("/rockets/{rocket_id}", response_model=RocketDetail)
def get_rocket(
    rocket_id: str,
    db: Db = Depends(get_db),
    storage: Storage = Depends(get_storage),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Return the full rocket record including manifest and gcs_ref.

    The ``manifest`` is the single source of truth in object storage
    (``parameters.json`` under the export prefix), NOT Firestore — it can
    contain nested arrays that Firestore Native rejects (see
    ``FirestoreDb.save_rocket``). It is loaded here from Storage and degrades to
    ``{}`` if the blob is missing, so the endpoint never 500s on a stale record.

    Returns 404 if the rocket_id is not found OR not owned by the caller's org.
    Satisfies REQ-04.4.
    """
    record = db.get_rocket(rocket_id, org_id=identity.org_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Rocket '{rocket_id}' not found.",
        )

    manifest: dict[str, Any] = {}
    try:
        raw = storage.open_blob(f"{record.export_prefix}parameters.json")
        manifest = json.loads(raw)
    except (KeyError, ValueError):
        # Blob absent (KeyError) or unparseable (ValueError/JSONDecodeError) —
        # serve an empty manifest rather than failing the detail request.
        manifest = {}

    return {
        "rocket_id": record.rocket_id,
        "name": record.name,
        "created_at": record.created_at.isoformat(),
        "created_by": record.created_by,
        "export_prefix": record.export_prefix,
        "manifest": manifest,
        "gcs_ref": record.gcs_ref,
        "ork_filename": record.ork_filename,
        "has_source_ork": record.has_source_ork,
    }
