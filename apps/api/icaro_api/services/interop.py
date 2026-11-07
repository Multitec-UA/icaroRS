"""Real flight interop store: the shared ``mt-interop`` collections (schema v1).

Ícaro and the MT1 flight-telemetry service share one Firestore database
(``ICARO_FIRESTORE_PROJECT``, database ``(default)``) and exchange one compact
document per flight instead of calling each other:

* ``interop_simulations/{simulation_id}``: written here after a simulation of
  an allowed organisation (``ICARO_INTEROP_ORGS``), read by the telemetry
  service. Schema ``mt-interop/simulation@1``.
* ``interop_real_flights/{flight_id}``: written by the telemetry service,
  read here. Schema ``mt-interop/real-flight@1``.

The contract is described in ``apps/api/README.md`` ("Real flight interop").
The flight-derived part of a simulation document (site, events, stats,
series) comes from the domain (``icaro.interop_simulation_payload``); this
module adds identity, tenancy and timestamps, and does the I/O.

Two adapters, chosen in ``icaro_api.runs.get_interop_store`` like ``Db``:

* ``InMemoryInteropStore``: dev / CI.
* ``FirestoreInteropStore``: production. Lists order by ``updated_at`` only and
  select the summary fields, so no composite index is needed.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from icaro import (
    INTEROP_SIMULATION_SCHEMA,
    InteropSchemaError,
    interop_simulation_from_series,
)

logger = logging.getLogger("icaro_api.interop")

SIMULATIONS_COLLECTION = "interop_simulations"
REAL_FLIGHTS_COLLECTION = "interop_real_flights"

#: Name of the run artefact that holds the domain payload (next to result.json).
INTEROP_ARTIFACT = "interop.json"

#: Fields a real flight summary needs; the list query selects only these.
REAL_FLIGHT_SUMMARY_FIELDS: tuple[str, ...] = (
    "schema",
    "flight_id",
    "device_id",
    "rocket",
    "launch_utc",
    "pad",
    "stats",
    "updated_at",
)

#: Most real flights one list call returns.
REAL_FLIGHTS_LIMIT = 100


# ---------------------------------------------------------------------------
# Protocol + adapters
# ---------------------------------------------------------------------------


@runtime_checkable
class InteropStore(Protocol):
    """Read/write access to the shared interop collections.

    Tenancy is the caller's job: the routers and ``publish_simulation_safely``
    check ``ICARO_INTEROP_ORGS`` before touching the store.
    """

    def publish_simulation(self, doc: dict[str, Any]) -> None:
        """Upsert ``interop_simulations/{doc['simulation_id']}``."""
        ...

    def list_real_flights(self, limit: int = REAL_FLIGHTS_LIMIT) -> list[dict[str, Any]]:
        """Real flight summaries (``REAL_FLIGHT_SUMMARY_FIELDS``), newest ``updated_at`` first."""
        ...

    def get_real_flight(self, flight_id: str) -> dict[str, Any] | None:
        """The full real flight document, or ``None`` when it does not exist."""
        ...


def _sort_key(doc: dict[str, Any]) -> str:
    return to_iso(doc.get("updated_at")) or ""


class InMemoryInteropStore:
    """Dict-backed ``InteropStore`` for dev and tests.

    ``put_real_flight`` stands in for the telemetry service writing a flight.
    """

    def __init__(self) -> None:
        self.simulations: dict[str, dict[str, Any]] = {}
        self.real_flights: dict[str, dict[str, Any]] = {}

    def publish_simulation(self, doc: dict[str, Any]) -> None:
        self.simulations[doc["simulation_id"]] = doc

    def put_real_flight(self, doc: dict[str, Any]) -> None:
        self.real_flights[doc["flight_id"]] = doc

    def list_real_flights(self, limit: int = REAL_FLIGHTS_LIMIT) -> list[dict[str, Any]]:
        rows = sorted(
            (d for d in self.real_flights.values() if d.get("updated_at") is not None),
            key=_sort_key,
            reverse=True,
        )
        return [{k: d[k] for k in REAL_FLIGHT_SUMMARY_FIELDS if k in d} for d in rows[:limit]]

    def get_real_flight(self, flight_id: str) -> dict[str, Any] | None:
        return self.real_flights.get(flight_id)


class FirestoreInteropStore:
    """Firestore-backed ``InteropStore`` (``google-cloud-firestore``, ``[gcp]`` extra).

    The client is created on first use, so resolving the dependency costs
    nothing when the feature is off.
    """

    def __init__(self, project: str, database: str = "(default)", client: Any = None) -> None:
        self._project = project
        self._database = database
        self._client = client

    @property
    def _db(self):
        if self._client is None:
            from google.cloud import firestore  # type: ignore[import]

            self._client = firestore.Client(project=self._project, database=self._database)
        return self._client

    def publish_simulation(self, doc: dict[str, Any]) -> None:
        self._db.collection(SIMULATIONS_COLLECTION).document(doc["simulation_id"]).set(doc)

    def list_real_flights(self, limit: int = REAL_FLIGHTS_LIMIT) -> list[dict[str, Any]]:
        # One single-field order (automatic index) and a projection: no
        # composite index, and the series never leave the database here.
        query = (
            self._db.collection(REAL_FLIGHTS_COLLECTION)
            .order_by("updated_at", direction="DESCENDING")
            .select(list(REAL_FLIGHT_SUMMARY_FIELDS))
            .limit(limit)
        )
        out: list[dict[str, Any]] = []
        for snap in query.stream():
            data = snap.to_dict() or {}
            data.setdefault("flight_id", snap.id)
            out.append(data)
        return out

    def get_real_flight(self, flight_id: str) -> dict[str, Any] | None:
        snap = self._db.collection(REAL_FLIGHTS_COLLECTION).document(flight_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        data.setdefault("flight_id", snap.id)
        return data


# ---------------------------------------------------------------------------
# Access boundary
# ---------------------------------------------------------------------------


def interop_org_ids(raw: str | None) -> frozenset[str]:
    """``ICARO_INTEROP_ORGS`` (comma-separated) as a set; empty means off."""
    return frozenset(part.strip() for part in (raw or "").split(",") if part.strip())


# ---------------------------------------------------------------------------
# Building the simulation document
# ---------------------------------------------------------------------------


def to_iso(value: Any) -> str | None:
    """A Firestore timestamp / datetime / string as an ISO-8601 string."""
    if value is None:
        return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    return str(value)


def motor_label(params: dict[str, Any] | None) -> str | None:
    """``"Cesaroni Technology 232H123-14A"`` from an export's ``parameters.json``."""
    identity = ((params or {}).get("motors") or {}).get("identity") or {}
    designation = identity.get("designation")
    if not designation:
        return None
    manufacturer = identity.get("manufacturer")
    return f"{manufacturer} {designation}" if manufacturer else str(designation)


def motor_label_from_dir(export_dir: Path) -> str | None:
    """``motor_label`` of an export directory; ``None`` on any read problem."""
    try:
        return motor_label(json.loads((export_dir / "parameters.json").read_text()))
    except Exception:  # noqa: BLE001 - the motor is a label, never fatal
        return None


def launch_date_from_scenario(scenario: dict[str, Any] | None) -> str | None:
    """The scenario's UTC launch date and hour as ``YYYY-MM-DDTHH:00:00Z``."""
    raw = (scenario or {}).get("launch_date")
    if not isinstance(raw, dict):
        return None
    try:
        return datetime(
            int(raw["year"]), int(raw["month"]), int(raw["day"]), int(raw.get("hour", 0)),
            tzinfo=timezone.utc,
        ).strftime("%Y-%m-%dT%H:00:00Z")
    except (KeyError, TypeError, ValueError):
        return None


def site_from_scenario(scenario: dict[str, Any] | None) -> dict[str, Any] | None:
    """``{lat, lon, elev_m}`` from a scenario's ``site``, when it has one."""
    site = (scenario or {}).get("site")
    if not isinstance(site, dict):
        return None
    try:
        return {
            "lat": float(site["latitude"]),
            "lon": float(site["longitude"]),
            "elev_m": float(site["elevation"]) if site.get("elevation") is not None else None,
        }
    except (KeyError, TypeError, ValueError):
        return None


def build_simulation_doc(
    payload: dict[str, Any],
    *,
    sim: Any,
    rocket_name: str | None,
    export_label: str | None,
    motor: str | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """The ``interop_simulations`` document for one run (schema v1).

    ``payload`` is the domain part (``site``, ``events``, ``stats``,
    ``series``); ``sim`` is the run's ``SimRecord``. An ``approximate``
    payload (a run older than the interop artefact) keeps the flag, an
    extra field readers may ignore.
    """
    now = now or datetime.now(timezone.utc)
    doc: dict[str, Any] = {
        "schema": INTEROP_SIMULATION_SCHEMA,
        "simulation_id": sim.simulation_id,
        "org_id": sim.org_id,
        "rocket_id": sim.rocket_id,
        "rocket_name": rocket_name,
        "export_id": sim.export_id,
        "export_label": export_label,
        "site": payload.get("site") or site_from_scenario(sim.scenario),
        "launch_date": launch_date_from_scenario(sim.scenario),
        "motor": motor,
        "events": payload.get("events", []),
        "stats": payload.get("stats", {}),
        "series": payload.get("series", {}),
        "created_at": sim.created_at,
        "updated_at": now,
    }
    if payload.get("approximate"):
        doc["approximate"] = True
    return doc


def load_run_payload(storage: Any, sim: Any) -> dict[str, Any]:
    """The domain payload of a stored run, without re-simulating.

    Reads ``{result_prefix}interop.json`` (runs simulated with this feature);
    for older runs builds the approximate payload from ``series.json`` and the
    record's scalars (``icaro.interop_simulation_from_series``).

    Raises
    ------
    LookupError
        The run has neither artefact.
    InteropSchemaError
        The stored series cannot be used.
    """
    try:
        return json.loads(storage.open_blob(f"{sim.result_prefix}{INTEROP_ARTIFACT}"))
    except KeyError:
        pass
    try:
        series = json.loads(storage.open_blob(f"{sim.result_prefix}series.json"))
    except KeyError as exc:
        raise LookupError(f"Run '{sim.simulation_id}' has no stored flight series.") from exc
    return interop_simulation_from_series(
        series, sim.scalars or {}, site=site_from_scenario(sim.scenario)
    )


def publish_simulation_safely(
    store: InteropStore,
    payload: dict[str, Any],
    *,
    sim: Any,
    rocket_name: str | None,
    export_label: str | None,
    motor: str | None,
) -> bool:
    """Publish one run; log and return ``False`` on any failure, never raise.

    The interop copy is a side channel: losing it must never fail the
    simulation that produced it.
    """
    try:
        doc = build_simulation_doc(
            payload, sim=sim, rocket_name=rocket_name, export_label=export_label, motor=motor
        )
        store.publish_simulation(doc)
        return True
    except Exception:
        logger.warning(
            "Could not publish interop simulation for run_id=%s", sim.simulation_id, exc_info=True
        )
        return False


__all__ = [
    "INTEROP_ARTIFACT",
    "REAL_FLIGHTS_COLLECTION",
    "REAL_FLIGHT_SUMMARY_FIELDS",
    "SIMULATIONS_COLLECTION",
    "FirestoreInteropStore",
    "InMemoryInteropStore",
    "InteropSchemaError",
    "InteropStore",
    "build_simulation_doc",
    "interop_org_ids",
    "launch_date_from_scenario",
    "load_run_payload",
    "motor_label",
    "motor_label_from_dir",
    "publish_simulation_safely",
    "site_from_scenario",
    "to_iso",
]
