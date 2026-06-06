"""Convert endpoint — POST /api/convert.

Accepts a multipart .ork file upload, calls convert_ork, uploads export
artifacts to Storage, saves a RocketRecord to Db, and returns a logical
``export_id`` (a URL-safe run_id slug — never a filesystem path).

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

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.security import HTTPBasicCredentials

from icaro_api.auth import require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.runs import get_db, get_storage, make_run_id
from icaro_api.services.convert import run_convert
from icaro_api.services.db import Db, RocketRecord
from icaro_api.services.storage import Storage

logger = logging.getLogger("icaro_api.convert")

router = APIRouter(
    tags=["convert"],
    dependencies=[Depends(require_auth)],
)


@router.post("/convert")
async def post_convert(
    file: UploadFile = File(..., description="OpenRocket .ork file"),
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
    credentials: HTTPBasicCredentials = Depends(require_auth),
) -> dict[str, Any]:
    """Convert a .ork file to an export directory and persist artifacts.

    Multipart upload → ``convert_ork`` → upload export dir to Storage
    under ``exports/{run_id}/`` → save RocketRecord to Db → returns
    ``{export_id, manifest}`` where ``export_id`` is a logical run_id slug.

    On ``ConvertUnavailableError``: 503 with the install hint verbatim.
    On non-.ork file: 422.
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

        # Upload export artifacts to Storage under exports/{run_id}/ (REQ-02.1).
        export_prefix = f"exports/{run_id}/"
        storage.upload_dir(export_prefix, export_dir)

        # Persist rocket metadata to Db (REQ-03.1).
        rocket_name = manifest.get("name", filename.removesuffix(".ork"))
        rec = RocketRecord(
            rocket_id=run_id,
            name=rocket_name,
            created_at=datetime.now(timezone.utc),
            created_by=credentials.username,
            export_prefix=export_prefix,
            manifest=manifest,
            gcs_ref=export_prefix,
            ork_filename=filename or None,
            has_source_ork=False,  # .ork upload to GCS deferred (REQ-02.8)
        )
        db.save_rocket(rec)

        # Return the logical id — NEVER a filesystem path (REQ-01.1).
        return {
            "export_id": run_id,
            "manifest": manifest,
        }

    finally:
        # Always clean up the temp upload file.
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
