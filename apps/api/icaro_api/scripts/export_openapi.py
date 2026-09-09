"""Export the FastAPI OpenAPI schema to a JSON file — issue #51.

``FastAPI.openapi()`` builds the schema from the already-wired ``app``
instance (routes, request/response models, ``Depends`` signatures); it does
**not** require a running server. This makes the export deterministic and
side-effect free, which is what apps/web's ``npm run api:schema`` needs: a
committed snapshot it can refresh on demand, without booting uvicorn or an
emulator (see apps/web/AGENTS.md and apps/web/openapi/README for the
committed-snapshot-vs-live-API decision).

Usage
-----
    uv run --package icaro-api python -m icaro_api.scripts.export_openapi \\
        ../web/openapi/schema.json

    # or print to stdout:
    uv run --package icaro-api python -m icaro_api.scripts.export_openapi
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from icaro_api.main import app


def export_schema() -> str:
    """Return the app's OpenAPI schema as pretty-printed, deterministic JSON."""
    schema = app.openapi()
    # sort_keys keeps the committed snapshot's diffs minimal and its byte
    # content independent of dict-insertion order across Python versions.
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


def main(argv: list[str]) -> int:
    text = export_schema()
    if argv:
        out_path = Path(argv[0])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(text, encoding="utf-8")
    else:
        sys.stdout.write(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
