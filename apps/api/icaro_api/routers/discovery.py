"""Discovery endpoints — atmosphere suggestion and elevation lookup.

Routes (all require auth via router-level dependency):
  GET /api/atmosphere/suggest?date=...  — model + reason + gfs_window flag
  GET /api/elevation?lat=...&lon=...    — DEM elevation lookup (best-effort)

Design §3 (discovery), §4 (elevation service).
Spec AC-RG-2.7, AC-RG-2.8, AC-RG-2.9, RG-2.6, RG-2.7.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status

from icaro.discovery import choose_atmosphere_model_for_date, gfs_window_check
from icaro_api.auth import require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.services.elevation import lookup_elevation

router = APIRouter(
    tags=["discovery"],
    dependencies=[Depends(require_auth)],
)


# ---------------------------------------------------------------------------
# GET /api/atmosphere/suggest
# ---------------------------------------------------------------------------


@router.get("/atmosphere/suggest")
async def suggest_atmosphere(
    date: str = Query(..., description="ISO 8601 date+time for the launch"),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Suggest the best atmosphere model for a given launch date.

    Calls ``choose_atmosphere_model_for_date`` from the icaro domain — the
    router encodes NO decision logic itself (RG-1.1, RG-1.5).

    Returns
    -------
    dict
        ``{model, reason, within_gfs_window, needs_internet}``

    Satisfies AC-RG-2.7, AC-RG-2.8, RG-2.6.
    """
    try:
        launch_dt = datetime.fromisoformat(date)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="'date' must be a valid ISO 8601 date-time string.",
        )

    online = settings.allow_forecast
    model, reason = choose_atmosphere_model_for_date(launch_dt, online=online)
    in_window = gfs_window_check(launch_dt)

    return {
        "model": model,
        "reason": reason,
        "within_gfs_window": in_window,
        "needs_internet": model == "forecast",
    }


# ---------------------------------------------------------------------------
# GET /api/elevation
# ---------------------------------------------------------------------------


@router.get("/elevation")
async def get_elevation(
    lat: float = Query(..., description="WGS-84 latitude in decimal degrees"),
    lon: float = Query(..., description="WGS-84 longitude in decimal degrees"),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    """Look up ground elevation at the given coordinates.

    Best-effort: on failure returns 503 (AC-RG-2.9).  The UI must handle
    this gracefully (show manual-entry fallback, never block simulate).

    Satisfies RG-2.7, AC-RG-2.9.
    """
    result = await lookup_elevation(lat, lon, settings)

    if result.source == "unavailable":
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "elevation_unavailable", "note": result.note},
        )

    return {
        "elevation": result.elevation,
        "source": result.source,
    }
