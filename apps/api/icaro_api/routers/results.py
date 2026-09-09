"""Results endpoints — serve run artifacts via Storage seam.

Routes (all require auth via router-level dependency):
  GET /api/results/{run_id}                   — result.json in job-status shape
  GET /api/results/{run_id}/plots/{name}.png  — serve a plot PNG
  GET /api/results/{run_id}/series            — flight time-series (issue #11)

All artifact reads go through ``Storage.open_blob`` — the storage seam is
authoritative (REQ-02.4, REQ-02.5, REQ-02.6).  Local disk fallback is removed;
GCS (or LocalFsStorage in dev/CI) is the single source of truth.

Ownership (issue #44): a ``run_id`` alone is not an access-control boundary —
it is a timestamp-prefixed id with 32 bits of entropy behind it. Every
endpoint resolves ``run_id`` to its ``SimRecord`` via ``Db.get_simulation``
and requires it to belong to the caller's org *before* touching Storage.
A mismatch (or an unknown run_id) is a 404, never a 403 — a 403 would
confirm the run exists, leaking another org's data.

Key scheme (matches Design §GCS Layout, REQ-02.7):
  result.json  → ``results/{run_id}/result.json``
  series.json  → ``results/{run_id}/series.json``
  plot PNG     → ``results/{run_id}/{name}.png``
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Response, status

from icaro_api.auth import Identity, require_auth
from icaro_api.runs import get_db, get_storage
from icaro_api.services.db import Db
from icaro_api.services.storage import Storage

router = APIRouter(
    tags=["results"],
    dependencies=[Depends(require_auth)],
)


def _authorize_run(run_id: str, db: Db, org_id: str, not_found_detail: str) -> None:
    """Raise 404 unless run_id resolves to a SimRecord owned by org_id.

    Same HTTPException shape as a missing artifact blob — the caller cannot
    distinguish "wrong org" from "no such run" (see module docstring).
    """
    if db.get_simulation(run_id, org_id=org_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found_detail)


@router.get("/results/{run_id}")
def get_result(
    run_id: str,
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Return the result for a completed run in forward-compat job-status shape.

    Response shape: ``{run_id, status: "done", result}``

    The shape is designed for forward-compat with an async/polling upgrade
    (ADR-6): when simulate becomes async, this endpoint will return
    ``{run_id, status: "running"|"done"|"error", progress?, result?}`` and
    the client polls — no contract break.

    Fetches ``results/{run_id}/result.json`` via the Storage seam (REQ-02.4).
    Returns 404 if the run is absent or not owned by the caller's org.
    """
    not_found = f"Run '{run_id}' not found."
    _authorize_run(run_id, db, identity.org_id, not_found)

    key = f"results/{run_id}/result.json"
    try:
        raw = storage.open_blob(key)
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found)

    try:
        result = json.loads(raw)
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
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Return the resampled flight time-series for a completed run (issue #11).

    Shape: ``{t, altitude, speed, mach, acceleration, path3d}`` — plain JSON
    arrays sharing one ``t`` axis, written by ``serialize_flight`` at simulate
    time. Powers the interactive 2D charts and the animated 3D trajectory.

    Fetches ``results/{run_id}/series.json`` via the Storage seam (REQ-02.6).
    Returns 404 if the run is absent, not owned by the caller's org, or the
    blob itself is missing (e.g. an old run predating this feature) — the
    client then falls back to the static PNG plots. Additive endpoint.
    """
    not_found = f"Series for run '{run_id}' not available."
    _authorize_run(run_id, db, identity.org_id, not_found)

    key = f"results/{run_id}/series.json"
    try:
        raw = storage.open_blob(key)
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found)

    try:
        return json.loads(raw)
    except Exception:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not read series file.",
        )


@router.get("/results/{run_id}/plots/{name}.png")
def get_plot(
    run_id: str,
    name: str,
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> Response:
    """Serve a plot PNG from Storage.

    Fetches ``results/{run_id}/{name}.png`` via the Storage seam (REQ-02.5).
    Returns 404 if the run is absent or not owned by the caller's org, or the
    plot blob itself is missing. PNGs are the artifacts most likely to be
    linked or embedded directly, so this check applies here too, not just to
    the JSON endpoints (issue #44).

    The ``name`` segment is sanitised (``Path.name``) to prevent directory
    traversal — same guard as the previous local-disk implementation.
    """
    not_found = f"Plot '{name}.png' not found for run '{run_id}'."
    _authorize_run(run_id, db, identity.org_id, not_found)

    # Sanitise: strip any path separators to prevent directory traversal.
    safe_name = Path(name).name
    key = f"results/{run_id}/{safe_name}.png"

    try:
        data = storage.open_blob(key)
    except KeyError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=not_found)

    return Response(content=data, media_type="image/png")
