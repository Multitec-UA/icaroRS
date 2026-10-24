"""Convert endpoint — POST /api/convert.

Accepts a multipart .ork file upload, calls convert_ork, uploads export
artifacts to Storage, saves an ExportRecord to Db (attached to a new rocket,
or to the rocket the user chose via the optional ``rocket_id`` form field)
and returns logical ``export_id`` / ``rocket_id`` slugs — never a filesystem
path.

On ConvertUnavailableError (Java/jar missing) → 503 with the hint verbatim
in the body (AC-RG-2.2).

Design §9 (packaging/convert optional extra).
Spec RG-2.1, AC-RG-2.1, AC-RG-2.2, REQ-01.1, REQ-02.1, REQ-03.1.
"""

from __future__ import annotations

import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from icaro_api.auth import Identity, require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.runs import get_db, get_storage, make_run_id
from icaro_api.services.convert import run_convert
from icaro_api.services.db import Db, ExportRecord, RocketRecord
from icaro_api.services.storage import Storage

logger = logging.getLogger("icaro_api.convert")

router = APIRouter(
    tags=["convert"],
    dependencies=[Depends(require_auth)],
)


class ConvertResult(BaseModel):
    """Response body for POST /api/convert."""

    export_id: str
    rocket_id: str
    manifest: dict[str, Any]


@router.post("/convert", response_model=ConvertResult)
async def post_convert(
    file: UploadFile = File(..., description="OpenRocket .ork file"),
    rocket_id: str | None = Form(
        None,
        description=(
            "Attach the file to this existing rocket. Omit to create a new rocket "
            "named after the file's manifest."
        ),
    ),
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Convert a .ork file to an export directory and persist artifacts.

    Multipart upload → ``convert_ork`` → upload export dir to Storage
    under ``orgs/{org_id}/exports/{run_id}/`` → save ExportRecord (and a new
    RocketRecord unless ``rocket_id`` was given) to Db → returns
    ``{export_id, rocket_id, manifest}`` where both ids are logical run_id slugs.

    Every file becomes its own rocket unless the user explicitly picks one of
    the org's rockets with ``rocket_id``; nothing is inferred from the filename.

    On ``ConvertUnavailableError``: 503 with the install hint verbatim.
    On non-.ork file: 422.
    On unknown / other-org ``rocket_id``: 404, before the conversion runs.
    Never returns a Python traceback (RG-9.4).

    Satisfies RG-2.1, AC-RG-2.1, AC-RG-2.2, REQ-01.1, REQ-02.1, REQ-03.1.
    """
    # Validate file extension.
    filename = file.filename or ""
    if not filename.lower().endswith(".ork"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Only .ork files are supported. Please upload an OpenRocket design file.",
        )

    # Resolve the destination rocket first: a 404 here must not cost a JVM run.
    rocket: RocketRecord | None = None
    if rocket_id:
        rocket = db.get_rocket(rocket_id, org_id=identity.org_id)
        if rocket is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Rocket '{rocket_id}' not found.",
            )

    # Save the upload to a temporary file.
    with tempfile.NamedTemporaryFile(suffix=".ork", delete=False) as tmp:
        contents = await file.read()
        tmp.write(contents)
        tmp_path = Path(tmp.name)

    try:
        # Mint a logical run_id — this becomes the export_id returned to the client.
        run_id = make_run_id()

        # Determine output dir: results_dir / run_id (local staging area).
        output_dir = settings.results_dir / run_id

        # Each conversion runs in its own subprocess so it gets a fresh JVM
        # (jpype cannot restart a JVM in the same process). The service never
        # raises for a conversion failure — it returns an outcome we map below.
        outcome = run_convert(
            ork_path=tmp_path,
            output_dir=output_dir,
            ork_jar=settings.ork_jar,
        )

        if outcome.get("status") == "unavailable":
            # Java/jar missing — hint is verbatim from icaro (AC-RG-2.2).
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"error": "convert_unavailable", "hint": outcome.get("hint", "")},
            )
        if outcome.get("status") != "ok":
            # Any other engine fault → clean 503, never a 500/traceback (RG-9.4).
            logger.error("convert failed for %s: %s", filename, outcome.get("message"))
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "convert_failed",
                    "hint": outcome.get(
                        "message",
                        "The conversion engine could not process this file. "
                        "Please try again or contact your administrator.",
                    ),
                },
            )

        export_dir = Path(outcome["export_dir"])

        # Load the manifest (parameters.json from the export directory).
        manifest: dict[str, Any] = {}
        params_file = export_dir / "parameters.json"
        if params_file.exists():
            try:
                manifest = json.loads(params_file.read_text())
            except Exception:  # noqa: BLE001
                manifest = {}

        # Upload export artifacts to Storage under orgs/{org_id}/exports/{run_id}/
        # (REQ-02.1; issue #45 — org-scoped keys are defense in depth under the
        # ownership check in routers/results.py). export_prefix is persisted on
        # the record and is the only thing any reader ever derives a key from.
        export_prefix = f"orgs/{identity.org_id}/exports/{run_id}/"
        storage.upload_dir(export_prefix, export_dir)

        # Persist metadata to Db (REQ-03.1): the export, and the rocket that
        # groups it when the user did not pick an existing one.
        now = datetime.now(timezone.utc)
        export_name = manifest.get("name", filename.removesuffix(".ork"))
        if rocket is None:
            rocket = RocketRecord(
                rocket_id=make_run_id(),
                name=export_name,
                created_at=now,
                created_by=identity.user_id,
                org_id=identity.org_id,
            )
            db.save_rocket(rocket, org_id=identity.org_id)

        rec = ExportRecord(
            export_id=run_id,
            rocket_id=rocket.rocket_id,
            name=export_name,
            created_at=now,
            created_by=identity.user_id,
            org_id=identity.org_id,
            export_prefix=export_prefix,
            manifest=manifest,
            gcs_ref=export_prefix,
            ork_filename=filename or None,
            has_source_ork=False,  # .ork upload to GCS deferred (REQ-02.8)
        )
        db.save_export(rec, org_id=identity.org_id)

        # Return the logical ids — NEVER a filesystem path (REQ-01.1).
        return {
            "export_id": run_id,
            "rocket_id": rocket.rocket_id,
            "manifest": manifest,
        }

    finally:
        # Always clean up the temp upload file.
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
