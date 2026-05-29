"""FastAPI application factory for icaroRS.

IMPORTANT: ``matplotlib.use("Agg")`` is set HERE, before any pyplot import
can be triggered by the import chain (rocketpy pulls pyplot on import).
This is the single place to set the non-interactive backend; never set it
elsewhere (RG-9.1, AC-RG-5.3).
"""

import matplotlib

matplotlib.use("Agg")  # noqa: E402 — MUST precede any pyplot/rocketpy import

from fastapi import FastAPI  # noqa: E402


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

    # Routers are registered here once implemented (Phase 1-E).
    # from icaro_api.routers import convert, scenario, simulate, results, discovery
    # app.include_router(convert.router, prefix="/api")
    # app.include_router(scenario.router, prefix="/api")
    # app.include_router(simulate.router, prefix="/api")
    # app.include_router(results.router, prefix="/api")
    # app.include_router(discovery.router, prefix="/api")

    return app


app = create_app()
