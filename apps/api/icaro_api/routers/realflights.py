"""Real flight endpoints: MT1 flights from the shared interop collection.

Routes (all require auth via the router-level dependency):
  GET /api/real-flights                          summaries, newest first
  GET /api/real-flights/{flight_id}              one flight, full document
  GET /api/results/{run_id}/compare/{flight_id}  simulated vs real comparison

Access boundary: only organisations listed in ``ICARO_INTEROP_ORGS`` see real
flights. For everyone else (and when the variable is unset) the list answers
``{enabled: false, flights: []}`` so the web can explain the empty state, and
the other two routes answer 404, exactly like an unknown id.

The comparison never re-simulates: it reads the run's stored
``interop.json`` (written at simulate time) or, for older runs, rebuilds an
approximate payload from ``series.json`` and the record's scalars, and hands
it to the domain use-case ``icaro.compare_with_real_flight``.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from icaro import InteropSchemaError, compare_with_real_flight
from pydantic import BaseModel, ConfigDict, Field

from icaro_api.auth import Identity, require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.routers.results import _get_owned_run
from icaro_api.runs import get_db, get_interop_store, get_storage
from icaro_api.services.db import Db
from icaro_api.services.interop import InteropStore, load_run_payload, to_iso
from icaro_api.services.storage import Storage

router = APIRouter(
    tags=["real-flights"],
    dependencies=[Depends(require_auth)],
)

_UNAVAILABLE = "Real flights are not available for this organization."


# ---------------------------------------------------------------------------
# Response models
# ---------------------------------------------------------------------------


class InteropSite(BaseModel):
    """A launch site or pad: WGS-84 degrees, elevation in m above sea level."""

    lat: float
    lon: float
    elev_m: float | None = None


class InteropEvent(BaseModel):
    """One flight event; ``t`` in s from liftoff. ``source`` is ``fsm`` or ``derived``."""

    id: str
    t: float
    label: str
    source: str | None = None


class RealFlightStats(BaseModel):
    """Headline numbers of a real flight (SI units, ``apogee_m`` above the pad)."""

    apogee_m: float | None = None
    apogee_t: float | None = None
    vmax_ms: float | None = None
    amax_ms2: float | None = None
    landing_t: float | None = None


class RealFlightSummary(BaseModel):
    """One row of the real flight picker."""

    flight_id: str
    device_id: str | None = None
    rocket: str | None = None
    launch_utc: str | None = None
    pad: InteropSite | None = None
    stats: RealFlightStats = Field(default_factory=RealFlightStats)
    updated_at: str | None = None


class RealFlightList(BaseModel):
    """Response of GET /api/real-flights. ``enabled`` is false when the feature is off."""

    enabled: bool
    flights: list[RealFlightSummary]


class RealFlightDetail(RealFlightSummary):
    """Response of GET /api/real-flights/{flight_id}: the ``mt-interop/real-flight@1`` document."""

    model_config = ConfigDict(populate_by_name=True)

    schema_name: str = Field(alias="schema")
    events: list[InteropEvent] = Field(default_factory=list)
    series: dict[str, list[float | None]] = Field(default_factory=dict)
    rate_hz: float | None = None
    source_samples: int | None = None
    server_version: str | None = None


class ComparisonSeries(BaseModel):
    """Both flights on one uniform time grid ``t`` (s); ``null`` outside a side's range."""

    t: list[float]
    sim: dict[str, list[float | None]]
    real: dict[str, list[float | None]]


class EventDeltaModel(BaseModel):
    """One event on both sides; deltas are simulated minus real."""

    id: str
    label: str
    sim_t: float | None = None
    real_t: float | None = None
    delta_t: float | None = None
    sim_value: float | None = None
    real_value: float | None = None
    delta_value: float | None = None
    value_unit: str | None = None


class KpiDeltaModel(BaseModel):
    """One headline number on both sides; ``delta`` is simulated minus real."""

    id: str
    unit: str
    sim: float | None = None
    real: float | None = None
    delta: float | None = None
    delta_pct: float | None = None


class ComparisonWarningModel(BaseModel):
    """An advisory with a stable ``code`` the web translates."""

    code: str
    message: str
    value: float | None = None


class ComparisonWindow(BaseModel):
    """Time span (s) where both flights have data: RMSE is computed over it."""

    t_start: float
    t_end: float


class FlightComparison(BaseModel):
    """Response of GET /api/results/{run_id}/compare/{flight_id}."""

    run_id: str
    flight_id: str
    real_flight: RealFlightSummary
    approximate: bool
    series: ComparisonSeries
    events: list[EventDeltaModel]
    kpis: list[KpiDeltaModel]
    rmse: dict[str, float | None]
    window: ComparisonWindow | None = None
    warnings: list[ComparisonWarningModel]
    site_distance_m: float | None = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _require_interop(settings: Settings, identity: Identity) -> None:
    if not settings.interop_enabled_for(identity.org_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_UNAVAILABLE)


def _summary(doc: dict[str, Any]) -> dict[str, Any]:
    """A stored document as a ``RealFlightSummary`` dict (timestamps as ISO strings)."""
    stats = doc.get("stats") if isinstance(doc.get("stats"), dict) else {}
    pad = doc.get("pad") if isinstance(doc.get("pad"), dict) else None
    return {
        "flight_id": str(doc.get("flight_id", "")),
        "device_id": doc.get("device_id"),
        "rocket": doc.get("rocket"),
        "launch_utc": to_iso(doc.get("launch_utc")),
        "pad": pad if pad and pad.get("lat") is not None and pad.get("lon") is not None else None,
        "stats": {k: stats.get(k) for k in RealFlightStats.model_fields},
        "updated_at": to_iso(doc.get("updated_at")),
    }


def _get_real_flight(store: InteropStore, flight_id: str) -> dict[str, Any]:
    doc = store.get_real_flight(flight_id)
    if doc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Real flight '{flight_id}' not found.",
        )
    return doc


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/real-flights", response_model=RealFlightList)
def list_real_flights(
    settings: Settings = Depends(get_settings),
    identity: Identity = Depends(require_auth),
    store: InteropStore = Depends(get_interop_store),
) -> dict[str, Any]:
    """Real MT1 flights published by the telemetry service, newest first.

    ``enabled: false`` with no flights when the caller's organization is not
    in ``ICARO_INTEROP_ORGS`` (or the variable is unset). Documents without a
    valid summary (no id) are skipped.
    """
    if not settings.interop_enabled_for(identity.org_id):
        return {"enabled": False, "flights": []}
    flights = [_summary(doc) for doc in store.list_real_flights()]
    return {"enabled": True, "flights": [f for f in flights if f["flight_id"]]}


@router.get("/real-flights/{flight_id}", response_model=RealFlightDetail)
def get_real_flight(
    flight_id: str,
    settings: Settings = Depends(get_settings),
    identity: Identity = Depends(require_auth),
    store: InteropStore = Depends(get_interop_store),
) -> dict[str, Any]:
    """One real flight: the full ``mt-interop/real-flight@1`` document.

    404 when the feature is off for the caller's organization or the flight
    does not exist.
    """
    _require_interop(settings, identity)
    doc = _get_real_flight(store, flight_id)
    series = doc.get("series") if isinstance(doc.get("series"), dict) else {}
    return {
        **_summary(doc),
        "schema": str(doc.get("schema", "")),
        "events": [e for e in doc.get("events") or [] if isinstance(e, dict) and "t" in e and "id" in e],
        "series": {k: v for k, v in series.items() if isinstance(v, list)},
        "rate_hz": doc.get("rate_hz"),
        "source_samples": doc.get("source_samples"),
        "server_version": doc.get("server_version"),
    }


@router.get("/results/{run_id}/compare/{flight_id}", response_model=FlightComparison)
def compare_run_with_real_flight(
    run_id: str,
    flight_id: str,
    settings: Settings = Depends(get_settings),
    identity: Identity = Depends(require_auth),
    store: InteropStore = Depends(get_interop_store),
    storage: Storage = Depends(get_storage),
    db: Db = Depends(get_db),
) -> dict[str, Any]:
    """Compare a run (the caller's org) with a real flight, from stored data only.

    404 when the feature is off for the organization, the run is not the
    organization's or does not exist, the flight does not exist, or the run
    has no stored flight data. 422 when the real flight document does not
    follow ``mt-interop/real-flight@1``. Runs simulated before the interop
    artefact existed compare approximately (``approximate: true`` plus a
    ``sim_approximate`` warning).
    """
    _require_interop(settings, identity)
    sim = _get_owned_run(run_id, db, identity.org_id, f"Run '{run_id}' not found.")
    real = _get_real_flight(store, flight_id)

    try:
        payload = load_run_payload(storage, sim)
    except (LookupError, InteropSchemaError) as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc

    try:
        comparison = compare_with_real_flight(payload, real)
    except InteropSchemaError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=f"Real flight '{flight_id}' cannot be compared: {exc}",
        ) from exc

    return {
        "run_id": run_id,
        "flight_id": flight_id,
        "real_flight": _summary(real),
        "approximate": bool(payload.get("approximate")),
        **comparison.to_dict(),
    }
