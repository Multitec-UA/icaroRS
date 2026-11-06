"""Launch-day endpoint — POST /api/launchday.

Sweeps the rail (inclination, heading) for one export and scenario with
``icaro.recommend_rail`` and returns the recommended setting plus the L1
launch checks for the current and the best setting.

Synchronous: every grid point is one flight, so a 72-point sweep takes from a
few seconds to about a minute. It does not take the simulate lock — no
matplotlib is involved and the domain silences RocketPy's stdout itself.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ValidationError

from icaro import recommend_rail
from icaro.scenario import Scenario
from icaro_api.auth import Identity, require_auth
from icaro_api.runs import get_db, get_storage
from icaro_api.services.db import Db
from icaro_api.services.storage import Storage

router = APIRouter(
    tags=["launchday"],
    dependencies=[Depends(require_auth)],
)


class LaunchDayRequest(BaseModel):
    """Request body for POST /api/launchday."""

    export_id: str
    """Logical export id returned by POST /api/convert."""

    scenario: dict[str, Any] | None = None
    """Same shape as /simulate's scenario (optional ``wind``); ``null`` uses icaro's defaults."""

    inclinations: list[float] | None = None
    """Rail inclinations to try (deg); within ``[90 - tilt_max, 90]``. Default grid when omitted."""

    headings: list[float] | None = None
    """Rail headings to try (deg from north). Default grid when omitted."""


class WindUsedModel(BaseModel):
    speed: float
    """m/s."""
    direction_from: float
    """Degrees from north the wind blows from."""
    source: Literal["manual", "model"]


class RailCandidateModel(BaseModel):
    inclination: float
    heading: float
    apogee_agl: float
    landing_distance: float
    landing_bearing: float
    out_of_rail_velocity: float
    stability_margin_min: float
    impact_velocity: float
    checks_ok: bool


class SkippedCandidateModel(BaseModel):
    inclination: float
    heading: float
    error: str


class LaunchCheckModel(BaseModel):
    id: str
    value: float
    limit: float | list[float]
    """A number, or ``[low, high]`` when ``comparator`` is ``between``."""
    comparator: Literal["<=", ">=", "between"]
    ok: bool
    severity: Literal["hard", "soft"]
    source: str


class LaunchLimitsModel(BaseModel):
    apogee_max_m: float
    apogee_recommended_max_m: float
    tilt_max_deg: float
    static_margin_min_cal: float
    descent_max_ms: float
    descent_recommended_ms: list[float]
    landing_radius_m: float
    rail_exit_min_ms: float
    wind_max_kmh: float


class LaunchDayResponse(BaseModel):
    """Response body for POST /api/launchday (``RailSweep.to_dict()``)."""

    wind: WindUsedModel
    current: RailCandidateModel
    best: RailCandidateModel | None
    candidates: list[RailCandidateModel]
    """Sorted by landing distance, closest first."""
    skipped: list[SkippedCandidateModel]
    limits: LaunchLimitsModel
    checks_current: list[LaunchCheckModel]
    checks_best: list[LaunchCheckModel] | None


def _unprocessable(detail: Any) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


@router.post("/launchday", response_model=LaunchDayResponse)
def run_launchday(
    body: LaunchDayRequest,
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
    identity: Identity = Depends(require_auth),
) -> dict[str, Any]:
    """Recommend the rail setting that lands closest to the pad (S5)."""
    scenario: Scenario | None = None
    if body.scenario is not None:
        try:
            scenario = Scenario.model_validate(body.scenario)
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
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Export '{body.export_id}' not found.",
        )

    grid: dict[str, list[float]] = {}
    if body.inclinations is not None:
        grid["inclinations"] = body.inclinations
    if body.headings is not None:
        grid["headings"] = body.headings

    with tempfile.TemporaryDirectory() as tmp_str:
        tmp_export = Path(tmp_str) / "export"
        tmp_export.mkdir()
        storage.download_dir(export.export_prefix, tmp_export)
        try:
            sweep = recommend_rail(str(tmp_export), scenario, **grid)
        except ValueError as exc:
            raise _unprocessable(str(exc))

    return sweep.to_dict()
