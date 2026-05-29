"""Convert service — runs each OpenRocket conversion in an isolated subprocess.

See ``convert_worker`` for the WHY (jpype starts a JVM once per process).  This
module is the parent side: it spawns a fresh Python process per conversion,
waits for it, and reads the JSON outcome the worker wrote.

The HTTP router calls :func:`run_convert` and maps the returned outcome's
``status`` to a response.  Keeping the spawn here (not in the router) keeps the
router thin and the subprocess concern in one place (edge/runtime, ``apps/api``).
"""

from __future__ import annotations

import json
import logging
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

logger = logging.getLogger("icaro_api.convert")

# JVM cold start (~10-15s) + conversion; generous ceiling so a slow first run
# is not killed, but a truly hung JVM cannot wedge the worker forever.
_CONVERT_TIMEOUT_S = 180

_WORKER_MODULE = "icaro_api.services.convert_worker"


def run_convert(
    ork_path: str | Path,
    output_dir: str | Path,
    ork_jar: str | Path | None,
    timeout: int = _CONVERT_TIMEOUT_S,
) -> dict[str, Any]:
    """Convert a ``.ork`` in an isolated subprocess; return the outcome dict.

    Returns one of:
      ``{"status": "ok", "export_dir": str}``
      ``{"status": "unavailable", "hint": str}``
      ``{"status": "error", "message": str}``

    Never raises for a conversion failure — every failure mode is mapped to an
    ``error``/``unavailable`` outcome so the router can shape a clean response
    (RG-9.4).
    """
    # The worker writes its outcome here (not stdout — the JVM may pollute it).
    with tempfile.NamedTemporaryFile(
        suffix=".json", prefix="icaro_convert_", delete=False
    ) as tmp:
        result_path = Path(tmp.name)

    cmd = [
        sys.executable,
        "-m",
        _WORKER_MODULE,
        str(ork_path),
        str(output_dir),
        str(result_path),
        str(ork_jar) if ork_jar else "",
    ]

    try:
        completed = subprocess.run(  # noqa: S603 — args are server-controlled paths
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        result_path.unlink(missing_ok=True)
        logger.error("convert subprocess timed out after %ss", timeout)
        return {
            "status": "error",
            "message": "Conversion timed out. The OpenRocket engine took too long to start.",
        }

    try:
        if result_path.exists():
            outcome: dict[str, Any] = json.loads(result_path.read_text(encoding="utf-8"))
            return outcome
    except Exception:  # noqa: BLE001 — fall through to the generic error below
        pass
    finally:
        result_path.unlink(missing_ok=True)

    # No parseable outcome file → the worker died before writing one.
    logger.error(
        "convert subprocess produced no outcome (rc=%s); stderr=%s",
        completed.returncode,
        (completed.stderr or "")[-500:],
    )
    return {
        "status": "error",
        "message": "The conversion engine failed to start. Please try again or contact your administrator.",
    }
