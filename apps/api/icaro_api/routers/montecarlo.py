"""Monte Carlo job endpoints — /api/montecarlo (S9).

A Monte Carlo run takes minutes, so it cannot live inside a request: submit
records a ``queued`` run and hands it to the process-wide job queue
(``services/montecarlo_jobs.py``), which runs one job at a time in a worker
subprocess. Clients poll ``GET /montecarlo/{run_id}`` for progress and the
summary result, and fetch the landing-ellipse KML once it is ``done``.

Every endpoint is org-scoped through ``Identity.org_id``: a run or export of
another org is a 404, indistinguishable from a missing one.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ValidationError

from icaro.scenario import Scenario
from icaro_api.auth import Identity, require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.runs import get_db, get_job_queue, get_storage, make_run_id
from icaro_api.services.db import Db, MonteCarloRecord
from icaro_api.services.montecarlo_jobs import MonteCarloJob, MonteCarloJobQueue
from icaro_api.services.storage import Storage

router = APIRouter(tags=["montecarlo"], dependencies=[Depends(require_auth)])

KML_MEDIA_TYPE = "application/vnd.google-earth.kml+xml"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class MonteCarloRequest(BaseModel):
    """Body of POST /api/montecarlo."""

    export_id: str
    scenario: dict[str, Any] | None = None
    """Same shape as /simulate's scenario; ``null`` uses icaro's defaults."""
    n: int
    """Number of flights; bounded by ICARO_MONTECARLO_MIN_N..MAX_N (10..500)."""


class MonteCarloSubmitted(BaseModel):
    run_id: str
    status: Literal["queued", "running", "done", "error"]
    queue_position: int | None


class MonteCarloProgress(BaseModel):
    done: int
    total: int


class ApogeeStatsModel(BaseModel):
    mean: float
    std: float
    min: float
    max: float
    p5: float
    p50: float
    p95: float


class LatLon(BaseModel):
    latitude: float
    longitude: float


class MonteCarloFiles(BaseModel):
    """Blob names under the run's storage prefix (``kml`` only with >= 3 flights)."""

    inputs: str | None = None
    outputs: str | None = None
    errors: str | None = None
    kml: str | None = None


class MonteCarloResultModel(BaseModel):
    """``icaro.MonteCarloResult.to_dict()``; ellipses are [lat, lon] polygons."""

    n_requested: int
    n_succeeded: int
    n_failed: int
    apogee_agl: list[float]
    apogee_stats: ApogeeStatsModel | None
    impact_x: list[float]
    impact_y: list[float]
    ellipse_sigmas: list[float]
    landing_ellipses: list[list[list[float]]]
    apogee_ellipses: list[list[list[float]]]
    origin: LatLon
    files: MonteCarloFiles


class MonteCarloSummary(BaseModel):
    run_id: str
    rocket_id: str
    export_id: str
    created_at: datetime
    created_by: str
    n: int
    status: Literal["queued", "running", "done", "error"]
    progress: MonteCarloProgress
    queue_position: int | None
    """Position in this instance's queue while ``queued``; ``null`` otherwise."""
    error: str | None
    finished_at: datetime | None


class MonteCarloRun(MonteCarloSummary):
    result: MonteCarloResultModel | None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _summary(rec: MonteCarloRecord, queue: MonteCarloJobQueue) -> dict[str, Any]:
    return {
        "run_id": rec.run_id,
        "rocket_id": rec.rocket_id,
        "export_id": rec.export_id,
        "created_at": rec.created_at,
        "created_by": rec.created_by,
        "n": rec.n,
        "status": rec.status,
        "progress": {"done": rec.progress_done, "total": rec.progress_total},
        "queue_position": queue.queue_position(rec.run_id) if rec.status == "queued" else None,
        "error": rec.error,
        "finished_at": rec.finished_at,
    }


def _get_or_404(db: Db, run_id: str, org_id: str) -> MonteCarloRecord:
    rec = db.get_montecarlo(run_id, org_id=org_id)
    if rec is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Monte Carlo run '{run_id}' not found.")
    return rec


def _unprocessable(errors: list[dict[str, Any]]) -> HTTPException:
    return HTTPException(status_code=422, detail=errors)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/montecarlo",
    response_model=MonteCarloSubmitted,
    status_code=status.HTTP_202_ACCEPTED,
)
def submit_montecarlo(
    body: MonteCarloRequest,
    settings: Settings = Depends(get_settings),
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
    queue: MonteCarloJobQueue = Depends(get_job_queue),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Queue a Monte Carlo run; one runs at a time per instance, the rest wait (FIFO)."""
    lo, hi = settings.montecarlo_min_n, settings.montecarlo_max_n
    if not lo <= body.n <= hi:
        raise _unprocessable(
            [{"loc": ["body", "n"], "field": "n",
              "message": f"n must be between {lo} and {hi}, got {body.n}."}]
        )
    if body.scenario is not None:
        try:
            Scenario.model_validate(body.scenario)
        except ValidationError as exc:
            raise _unprocessable(
                [
                    {
                        "loc": list(err.get("loc", [])),
                        "field": ".".join(
                            str(p) for p in err.get("loc", []) if p != "__root__"
                        ),
                        "message": err.get("msg", "Validation error"),
                    }
                    for err in exc.errors()
                ]
            )

    export = db.get_export(body.export_id, org_id=identity.org_id)
    if export is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Export '{body.export_id}' not found.")

    rec = MonteCarloRecord(
        run_id=make_run_id(),
        rocket_id=export.rocket_id,
        export_id=body.export_id,
        org_id=identity.org_id,
        created_by=identity.user_id,
        created_at=datetime.now(timezone.utc),
        scenario=body.scenario,
        n=body.n,
        status="queued",
        progress_done=0,
        progress_total=body.n,
    )
    db.save_montecarlo(rec, org_id=identity.org_id)
    position = queue.submit(
        MonteCarloJob(record=rec, export_prefix=export.export_prefix, db=db, storage=storage)
    )
    return {"run_id": rec.run_id, "status": "queued", "queue_position": position}


@router.get("/montecarlo", response_model=list[MonteCarloSummary])
def list_montecarlo(
    rocket_id: str | None = Query(None, description="Only this rocket's runs."),
    limit: int = Query(50, ge=1, le=100),
    db: Db = Depends(get_db),
    queue: MonteCarloJobQueue = Depends(get_job_queue),
    identity: Identity = Depends(require_auth),
) -> list[dict[str, Any]]:
    """The org's Monte Carlo runs, newest first (without results)."""
    rows = db.list_montecarlo(identity.org_id, rocket_id=rocket_id, limit=limit)
    return [_summary(r, queue) for r in rows]


@router.get("/montecarlo/{run_id}", response_model=MonteCarloRun)
def get_montecarlo(
    run_id: str,
    db: Db = Depends(get_db),
    queue: MonteCarloJobQueue = Depends(get_job_queue),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Status, progress and (once done) the summary result of one run."""
    rec = _get_or_404(db, run_id, identity.org_id)
    return {**_summary(rec, queue), "result": rec.result if rec.status == "done" else None}


@router.get(
    "/montecarlo/{run_id}/kml",
    response_class=Response,
    responses={200: {"content": {KML_MEDIA_TYPE: {}}}},
)
def get_montecarlo_kml(
    run_id: str,
    db: Db = Depends(get_db),
    storage: Storage = Depends(get_storage),
    identity: Identity = Depends(require_auth),
) -> Response:
    """The landing/apogee ellipses as KML; 404 until done or when not produced."""
    rec = _get_or_404(db, run_id, identity.org_id)
    name = ((rec.result or {}).get("files") or {}).get("kml")
    if rec.status != "done" or not rec.result_prefix or not name:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No KML for Monte Carlo run '{run_id}'.")
    try:
        data = storage.open_blob(f"{rec.result_prefix}{name}")
    except KeyError:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No KML for Monte Carlo run '{run_id}'.")
    return Response(content=data, media_type=KML_MEDIA_TYPE)
