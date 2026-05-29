"""Convert endpoint — POST /api/convert.

Accepts a multipart .ork file upload, calls convert_ork, returns export_id
and manifest.  On ConvertUnavailableError (Java/jar missing) → 503 with the
hint verbatim in the body (AC-RG-2.2).

Design §9 (packaging/convert optional extra).
Spec RG-2.1, AC-RG-2.1, AC-RG-2.2.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status

from icaro import convert_ork
from icaro.convert import ConvertUnavailableError
from icaro_api.auth import require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.runs import make_run_id

router = APIRouter(
    tags=["convert"],
    dependencies=[Depends(require_auth)],
)


@router.post("/convert")
async def post_convert(
    file: UploadFile = File(..., description="OpenRocket .ork file"),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Convert a .ork file to an export directory.

    Multipart upload → ``convert_ork`` → returns ``{export_id, manifest}``.

    On ``ConvertUnavailableError``: 503 with the install hint verbatim.
    On non-.ork file: 422.
    Never returns a Python traceback (RG-9.4).

    Satisfies RG-2.1, AC-RG-2.1, AC-RG-2.2.
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
        # Determine output dir: results_dir / run_id (so the export is durable).
        run_id = make_run_id()
        output_dir = settings.results_dir / run_id

        try:
            export_dir = convert_ork(
                ork_path=tmp_path,
                output_dir=output_dir,
                ork_jar=settings.ork_jar,
            )
        except ConvertUnavailableError as exc:
            # Hint is the str() of the exception — pass it verbatim (AC-RG-2.2).
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "error": "convert_unavailable",
                    "hint": str(exc),
                },
            )
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            )

        # Load the manifest (parameters.json from the export directory).
        manifest: dict[str, Any] = {}
        params_file = Path(export_dir) / "parameters.json"
        if params_file.exists():
            try:
                manifest = json.loads(params_file.read_text())
            except Exception:  # noqa: BLE001
                manifest = {}

        return {
            "export_id": str(export_dir),
            "manifest": manifest,
        }

    finally:
        # Always clean up the temp upload file.
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:  # noqa: BLE001
            pass
