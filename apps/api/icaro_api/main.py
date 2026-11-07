"""FastAPI application factory for icaroRS.

IMPORTANT: ``matplotlib.use("Agg")`` is set HERE, before any pyplot import
can be triggered by the import chain (rocketpy pulls pyplot on import).
This is the single place to set the non-interactive backend; never set it
elsewhere (RG-9.1, AC-RG-5.3).
"""

import matplotlib

matplotlib.use("Agg")  # noqa: E402 — MUST precede any pyplot/rocketpy import

import logging  # noqa: E402
from contextlib import asynccontextmanager  # noqa: E402

from fastapi import FastAPI  # noqa: E402

from icaro_api.routers import convert, discovery, exports, results, rockets, history, launchday, montecarlo, realflights, scenario, session, simulate  # noqa: E402

logger = logging.getLogger("icaro_api.startup")


def _recover_montecarlo(app: FastAPI) -> None:
    """Mark Monte Carlo runs a previous process left queued/running as error (S10).

    Resolves the Db the same way requests do (honouring
    ``app.dependency_overrides`` in tests). A failure here is logged, never
    fatal: it must not keep the API from serving.
    """
    from icaro_api.config import get_settings
    from icaro_api.runs import get_db
    from icaro_api.services.montecarlo_jobs import recover_interrupted_montecarlo

    try:
        override_db = app.dependency_overrides.get(get_db)
        if override_db is not None:
            db = override_db()
        else:
            settings = app.dependency_overrides.get(get_settings, get_settings)()
            db = get_db(settings)
        count = recover_interrupted_montecarlo(db)
        if count:
            logger.warning("Marked %d interrupted Monte Carlo run(s) as error.", count)
    except Exception:  # noqa: BLE001
        logger.error("Monte Carlo startup recovery failed", exc_info=True)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    _recover_montecarlo(app)
    yield


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
        lifespan=_lifespan,
    )

    # All routers mounted under /api.  Auth is applied at router-level via
    # ``dependencies=[Depends(require_auth)]`` in each router declaration
    # (satisfies RG-8.1, task 1.12 deferred to here).
    # `session` mints/clears the Identity Platform cookie the rest verify —
    # its own routes are unauthenticated (/session, /logout) or self-gated (/me).
    app.include_router(session.router, prefix="/api")
    app.include_router(convert.router, prefix="/api")
    app.include_router(scenario.router, prefix="/api")
    app.include_router(simulate.router, prefix="/api")
    app.include_router(results.router, prefix="/api")
    app.include_router(rockets.router, prefix="/api")
    app.include_router(exports.router, prefix="/api")
    app.include_router(history.router, prefix="/api")
    app.include_router(discovery.router, prefix="/api")
    app.include_router(montecarlo.router, prefix="/api")
    app.include_router(launchday.router, prefix="/api")
    app.include_router(realflights.router, prefix="/api")

    return app


app = create_app()
