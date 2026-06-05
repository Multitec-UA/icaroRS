"""Database service — metadata persistence abstraction (Design §Interfaces, REQ-03).

Two adapters:

* ``InMemoryDb`` — dict-backed in-process store.  Dev / CI only.
* ``FirestoreDb`` — wraps ``google.cloud.firestore``.  Production.

The ``Db`` Protocol is the surface routers touch; adapter choice is in ``runs.py``.

Firestore collections (Design §Firestore Shape)
------------------------------------------------
* ``rockets``     — id == rocket_id (== export_id / convert run id)
* ``simulations`` — id == simulation_id (== simulate run id)
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable


# ---------------------------------------------------------------------------
# Records (shared by all adapters)
# ---------------------------------------------------------------------------


@dataclass
class RocketRecord:
    """Firestore ``rockets`` document shape.

    Attributes
    ----------
    rocket_id : str
        Unique stable id (== convert run_id, returned as ``export_id``).
    name : str
        Rocket name from ``parameters.json`` ``manifest["name"]``.
    created_at : datetime
        UTC timestamp of the convert request.
    created_by : str
        HTTP Basic username (informational only — not an access-control key).
    export_prefix : str
        GCS prefix where export artifacts live, e.g. ``exports/{rocket_id}/``.
    manifest : dict[str, Any]
        Full ``parameters.json`` content.
    gcs_ref : str
        Same as *export_prefix* (kept as separate field for API surface clarity).
    ork_filename : str | None
        Original ``.ork`` filename, ``None`` if not stored.
    has_source_ork : bool
        Whether the ``.ork`` was uploaded to GCS.
    """

    rocket_id: str
    name: str
    created_at: datetime
    created_by: str
    export_prefix: str
    manifest: dict[str, Any] = field(default_factory=dict)
    gcs_ref: str = ""
    ork_filename: str | None = None
    has_source_ork: bool = False


@dataclass
class SimRecord:
    """Firestore ``simulations`` document shape.

    Attributes
    ----------
    simulation_id : str
        Unique id (== simulate run_id).
    rocket_id : str
        Foreign reference to the ``rockets`` collection.
    scenario : dict[str, Any]
        Full scenario JSON as submitted by the client.
    created_at : datetime
        UTC timestamp of the simulate request start.
    created_by : str
        HTTP Basic username (informational only).
    status : str
        ``"done"`` on success, ``"error"`` on failure.
    scalars : dict[str, Any]
        Flight result scalars.
    warnings : list[str]
        Warning strings captured during simulation.
    result_prefix : str
        GCS prefix for simulation artifacts, e.g. ``results/{simulation_id}/``.
    plot_names : list[str]
        List of plot PNG filenames stored under *result_prefix*.
    has_series : bool
        Whether ``series.json`` was uploaded.
    artifact_refs : dict[str, str]
        GCS keys for ``result.json``, ``series.json``, and any PNGs.
    """

    simulation_id: str
    rocket_id: str
    scenario: dict[str, Any]
    created_at: datetime
    created_by: str
    status: str
    scalars: dict[str, Any] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    result_prefix: str = ""
    plot_names: list[str] = field(default_factory=list)
    has_series: bool = False
    artifact_refs: dict[str, str] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class Db(Protocol):
    """Metadata store abstraction used by all routers."""

    def save_rocket(self, rec: RocketRecord) -> None:
        """Persist a rocket record (upsert by rocket_id)."""
        ...

    def get_rocket(self, rocket_id: str) -> RocketRecord | None:
        """Return the rocket record, or ``None`` if not found."""
        ...

    def list_rockets(self, limit: int = 20, before: datetime | None = None) -> list[RocketRecord]:
        """Return rockets in reverse-chronological order.

        Parameters
        ----------
        limit : int
            Maximum number of records to return (default 20, max 100).
        before : datetime | None
            If set, return only records with ``created_at < before``
            (cursor pagination).
        """
        ...

    def save_simulation(self, rec: SimRecord) -> None:
        """Persist a simulation record (upsert by simulation_id)."""
        ...

    def list_simulations(self, limit: int = 20, before: datetime | None = None) -> list[SimRecord]:
        """Return simulations in reverse-chronological order.

        Parameters
        ----------
        limit : int
            Maximum number of records to return (default 20, max 100).
        before : datetime | None
            Cursor — only records with ``created_at < before``.
        """
        ...


# ---------------------------------------------------------------------------
# InMemoryDb — dev / CI adapter
# ---------------------------------------------------------------------------


class InMemoryDb:
    """In-process dictionary-backed ``Db`` adapter.

    Thread-safe only for single-threaded tests.  Do NOT use in production.
    """

    def __init__(self) -> None:
        self._rockets: dict[str, RocketRecord] = {}
        self._simulations: dict[str, SimRecord] = {}

    # ------------------------------------------------------------------
    # Rocket operations
    # ------------------------------------------------------------------

    def save_rocket(self, rec: RocketRecord) -> None:
        """Upsert a rocket record keyed by ``rocket_id``."""
        self._rockets[rec.rocket_id] = rec

    def get_rocket(self, rocket_id: str) -> RocketRecord | None:
        """Return the rocket record or ``None``."""
        return self._rockets.get(rocket_id)

    def list_rockets(self, limit: int = 20, before: datetime | None = None) -> list[RocketRecord]:
        """Return rockets reverse-chronologically, optionally from cursor."""
        records = sorted(
            self._rockets.values(),
            key=lambda r: r.created_at,
            reverse=True,
        )
        if before is not None:
            records = [r for r in records if r.created_at < before]
        return records[:limit]

    # ------------------------------------------------------------------
    # Simulation operations
    # ------------------------------------------------------------------

    def save_simulation(self, rec: SimRecord) -> None:
        """Upsert a simulation record keyed by ``simulation_id``."""
        self._simulations[rec.simulation_id] = rec

    def list_simulations(self, limit: int = 20, before: datetime | None = None) -> list[SimRecord]:
        """Return simulations reverse-chronologically, optionally from cursor."""
        records = sorted(
            self._simulations.values(),
            key=lambda r: r.created_at,
            reverse=True,
        )
        if before is not None:
            records = [r for r in records if r.created_at < before]
        return records[:limit]


# ---------------------------------------------------------------------------
# FirestoreDb — production adapter (stub; full impl in Step 10)
# ---------------------------------------------------------------------------


class FirestoreDb:
    """Firestore-backed ``Db`` adapter.

    Requires ``google-cloud-firestore`` to be installed.

    Parameters
    ----------
    project : str
        GCP project id (from ``Settings.firestore_project``).
    database : str
        Firestore database name (default ``"(default)"``).
    """

    def __init__(self, project: str, database: str = "(default)") -> None:
        from google.cloud import firestore  # type: ignore[import]

        self._db = firestore.Client(project=project, database=database)

    # ------------------------------------------------------------------
    # Rocket operations
    # ------------------------------------------------------------------

    def save_rocket(self, rec: RocketRecord) -> None:
        """Write rocket document to Firestore collection ``rockets``."""
        doc = asdict(rec)
        doc["created_at"] = rec.created_at  # keep as datetime; Firestore handles it
        self._db.collection("rockets").document(rec.rocket_id).set(doc)

    def get_rocket(self, rocket_id: str) -> RocketRecord | None:
        """Fetch a single rocket document or return ``None``."""
        snap = self._db.collection("rockets").document(rocket_id).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        return RocketRecord(
            rocket_id=rocket_id,
            name=d.get("name", ""),
            created_at=d.get("created_at", datetime.now(timezone.utc)),
            created_by=d.get("created_by", ""),
            export_prefix=d.get("export_prefix", ""),
            manifest=d.get("manifest", {}),
            gcs_ref=d.get("gcs_ref", ""),
            ork_filename=d.get("ork_filename"),
            has_source_ork=d.get("has_source_ork", False),
        )

    def list_rockets(self, limit: int = 20, before: datetime | None = None) -> list[RocketRecord]:
        """Query rockets reverse-chronologically with optional cursor.

        Uses the ``"DESCENDING"`` direction string (accepted by all Firestore
        SDK versions) instead of importing ``Query.DESCENDING`` at call time —
        this keeps the method mockable without a live ``google`` package.
        """
        q = (
            self._db.collection("rockets")
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
        )
        if before is not None:
            q = q.start_after({"created_at": before})
        snaps = q.stream()
        result = []
        for snap in snaps:
            d = snap.to_dict()
            result.append(
                RocketRecord(
                    rocket_id=snap.id,
                    name=d.get("name", ""),
                    created_at=d.get("created_at", datetime.now(timezone.utc)),
                    created_by=d.get("created_by", ""),
                    export_prefix=d.get("export_prefix", ""),
                    manifest=d.get("manifest", {}),
                    gcs_ref=d.get("gcs_ref", ""),
                    ork_filename=d.get("ork_filename"),
                    has_source_ork=d.get("has_source_ork", False),
                )
            )
        return result

    # ------------------------------------------------------------------
    # Simulation operations
    # ------------------------------------------------------------------

    def save_simulation(self, rec: SimRecord) -> None:
        """Write simulation document to Firestore collection ``simulations``."""
        doc = asdict(rec)
        doc["created_at"] = rec.created_at
        self._db.collection("simulations").document(rec.simulation_id).set(doc)

    def list_simulations(self, limit: int = 20, before: datetime | None = None) -> list[SimRecord]:
        """Query simulations reverse-chronologically with optional cursor.

        Uses ``"DESCENDING"`` direction string — same rationale as
        :meth:`list_rockets` (mockable without live ``google`` package).
        """
        q = (
            self._db.collection("simulations")
            .order_by("created_at", direction="DESCENDING")
            .limit(limit)
        )
        if before is not None:
            q = q.start_after({"created_at": before})
        snaps = q.stream()
        result = []
        for snap in snaps:
            d = snap.to_dict()
            result.append(
                SimRecord(
                    simulation_id=snap.id,
                    rocket_id=d.get("rocket_id", ""),
                    scenario=d.get("scenario", {}),
                    created_at=d.get("created_at", datetime.now(timezone.utc)),
                    created_by=d.get("created_by", ""),
                    status=d.get("status", "done"),
                    scalars=d.get("scalars", {}),
                    warnings=d.get("warnings", []),
                    result_prefix=d.get("result_prefix", ""),
                    plot_names=d.get("plot_names", []),
                    has_series=d.get("has_series", False),
                    artifact_refs=d.get("artifact_refs", {}),
                )
            )
        return result
