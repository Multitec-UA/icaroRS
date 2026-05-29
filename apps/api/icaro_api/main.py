"""FastAPI application factory for icaroRS.

IMPORTANT: ``matplotlib.use("Agg")`` is set HERE, before any pyplot import
can be triggered by the import chain (rocketpy pulls pyplot on import).
This is the single place to set the non-interactive backend; never set it
elsewhere (RG-9.1, AC-RG-5.3).
"""

import matplotlib

matplotlib.use("Agg")  # noqa: E402 — MUST precede any pyplot/rocketpy import

from pathlib import Path  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from fastapi.staticfiles import StaticFiles  # noqa: E402

from icaro_api.routers import convert, discovery, results, scenario, simulate, ui  # noqa: E402

_STATIC_DIR = Path(__file__).parent / "static"


def create_app() -> FastAPI:
    """Create and configure the FastAPI application.

    Returns
    -------
    FastAPI
        Fully wired application instance ready to be served by uvicorn.
    """
    app = FastAPI(
        title="icaroRS API",
        description=(
            "HTTP delivery surface for icaroRS rocket simulation. "
            "Thin adapter over the icaro domain package."
        ),
        version="0.1.0",
    )

    # All routers mounted under /api.  Auth is applied at router-level via
    # ``dependencies=[Depends(require_auth)]`` in each router declaration
    # (satisfies RG-8.1, task 1.12 deferred to here).
    app.include_router(convert.router, prefix="/api")
    app.include_router(scenario.router, prefix="/api")
    app.include_router(simulate.router, prefix="/api")
    app.include_router(results.router, prefix="/api")
    app.include_router(discovery.router, prefix="/api")

    # Phase 1-F: Jinja2 wizard UI routes (no prefix — routes at /, /step2, etc.)
    # Auth is applied at router level in ui.py (same require_auth dependency).
    # Browser Basic creds set once on the first /api 401 cover same-origin UI
    # routes and XHR calls transparently.
    app.include_router(ui.router)

    # Static files for wizard.css and wizard.js
    if _STATIC_DIR.exists():
        app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

    return app


app = create_app()
