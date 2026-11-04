"""Exports endpoint — one converted ``.ork`` file.

Routes (all require auth via router-level dependency):
  GET /api/exports/{export_id}   — export metadata + manifest

``ork_revision`` tells apart the imports of one ``.ork`` file name within a
rocket: they are numbered 1..n by import date (``created_at``, then
``export_id`` on a tie). A file name imported once, or an export without a
file name, has ``None``. Computed on read from the rocket's exports
(``MAX_EXPORTS_PER_ROCKET`` newest), never stored.

An *export* is what ``POST /api/convert`` produces and what
``POST /api/simulate`` runs. Exports belong to a *rocket* (see
``routers/rockets.py``); the rocket detail lists them.
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Iterable
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

#: How many of a rocket's exports its detail lists and revisions count over.
MAX_EXPORTS_PER_ROCKET = 100


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
    ork_revision: int | None = None


class ExportDetail(ExportSummary):
    """Response body for GET /api/exports/{export_id} — summary plus manifest."""

    manifest: dict[str, Any]


def ork_revisions(exports: Iterable[ExportRecord]) -> dict[str, int | None]:
    """Number the exports that share an ``ork_filename`` 1..n by import date.

    Every export id maps to its revision, or ``None`` when its file name is
    missing or appears once. Pass one rocket's exports of one organization.
    """
    exports = list(exports)
    by_name: dict[str, list[ExportRecord]] = defaultdict(list)
    for rec in exports:
        if rec.ork_filename:
            by_name[rec.ork_filename].append(rec)
    revisions: dict[str, int | None] = {rec.export_id: None for rec in exports}
    for same_name in by_name.values():
        if len(same_name) > 1:
            ordered = sorted(same_name, key=lambda rec: (rec.created_at, rec.export_id))
            for number, rec in enumerate(ordered, start=1):
                revisions[rec.export_id] = number
    return revisions


def rocket_ork_revisions(db: Db, org_id: str, rocket_id: str) -> dict[str, int | None]:
    """``ork_revisions`` over one rocket's exports, read from the Db."""
    return ork_revisions(db.list_exports(org_id=org_id, limit=MAX_EXPORTS_PER_ROCKET, rocket_id=rocket_id))


def export_summary(rec: ExportRecord, revision: int | None = None) -> dict[str, Any]:
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
        "ork_revision": revision,
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
    revision = rocket_ork_revisions(db, identity.org_id, record.rocket_id).get(export_id)
    return {**export_summary(record, revision), "manifest": load_manifest(storage, record.export_prefix)}
