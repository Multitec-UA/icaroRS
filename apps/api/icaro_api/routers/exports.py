"""Exports endpoint — one converted ``.ork`` file.

Routes (all require auth via router-level dependency):
  GET /api/exports/{export_id}   — export metadata + manifest

An *export* is what ``POST /api/convert`` produces and what
``POST /api/simulate`` runs. Exports belong to a *rocket* (see
``routers/rockets.py``); the rocket detail lists them.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from icaro_api.auth import Identity, require_auth
from icaro_api.runs import get_db, get_storage
from icaro_api.services.db import Db, ExportRecord
from icaro_api.services.storage import Storage

router = APIRouter(
    tags=["exports"],
    dependencies=[Depends(require_auth)],
)


class ExportSummary(BaseModel):
    """One export (converted ``.ork``) as listed inside a rocket detail."""

    export_id: str
    rocket_id: str
    name: str
    created_at: str
    created_by: str
    export_prefix: str
    gcs_ref: str
    ork_filename: str | None
    has_source_ork: bool


class ExportDetail(ExportSummary):
    """Response body for GET /api/exports/{export_id} — summary plus manifest."""

    manifest: dict[str, Any]


def export_summary(rec: ExportRecord) -> dict[str, Any]:
    """Serialise an ``ExportRecord`` to the ``ExportSummary`` wire shape."""
    return {
        "export_id": rec.export_id,
        "rocket_id": rec.rocket_id,
        "name": rec.name,
        "created_at": rec.created_at.isoformat(),
        "created_by": rec.created_by,
        "export_prefix": rec.export_prefix,
        "gcs_ref": rec.gcs_ref,
        "ork_filename": rec.ork_filename,
        "has_source_ork": rec.has_source_ork,
    }


def load_manifest(storage: Storage, export_prefix: str) -> dict[str, Any]:
    """Read ``parameters.json`` under *export_prefix*, degrading to ``{}``.

    The manifest is the single source of truth in object storage, NOT
    Firestore — it can contain nested arrays that Firestore Native rejects
    (see ``FirestoreDb.save_export``). A missing (KeyError) or unparseable
    (ValueError) blob yields ``{}`` so the endpoint never 500s on a stale record.
    """
    try:
        return json.loads(storage.open_blob(f"{export_prefix}parameters.json"))
    except (KeyError, ValueError):
        return {}


@router.get("/exports/{export_id}", response_model=ExportDetail)
def get_export(
    export_id: str,
    db: Db = Depends(get_db),
    storage: Storage = Depends(get_storage),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Return the export record including its manifest.

    Returns 404 if the export_id is not found OR not owned by the caller's org.
    """
    record = db.get_export(export_id, org_id=identity.org_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Export '{export_id}' not found.",
        )
    return {**export_summary(record), "manifest": load_manifest(storage, record.export_prefix)}
