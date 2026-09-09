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
        Identity Platform user id of the creator — a genuine per-user audit
        field now that ``org_id`` is the access-control key.
    org_id : str
        Owning organization — the tenancy boundary. Every read is filtered by
        this in the ``Db`` layer (never in routers); see ``Db.list_rockets``.
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
    org_id: str
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
        Identity Platform user id of the creator — a genuine per-user audit
        field now that ``org_id`` is the access-control key.
    org_id : str
        Owning organization — the tenancy boundary. Every read is filtered by
        this in the ``Db`` layer (never in routers); see ``Db.list_simulations``.
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
    org_id: str
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
    """Metadata store abstraction used by all routers.

    ``org_id`` is a **required** parameter on every method — never optional
    with a default. This is the tenancy boundary: putting it in the protocol
    signature makes a router that forgets to scope a query a type error
    instead of a silent cross-organization leak.
    """

    def save_rocket(self, rec: RocketRecord, org_id: str) -> None:
        """Persist a rocket record (upsert by rocket_id), owned by org_id."""
        ...

    def get_rocket(self, rocket_id: str, org_id: str) -> RocketRecord | None:
        """Return the rocket record, or ``None`` if not found OR not owned by org_id."""
        ...

    def list_rockets(
        self, org_id: str, limit: int = 20, before: datetime | None = None
    ) -> list[RocketRecord]:
        """Return org_id's rockets in reverse-chronological order.

        Parameters
        ----------
        org_id : str
            Only rockets owned by this organization are returned.
        limit : int
            Maximum number of records to return (default 20, max 100).
        before : datetime | None
            If set, return only records with ``created_at < before``
            (cursor pagination).
        """
        ...

    def save_simulation(self, rec: SimRecord, org_id: str) -> None:
        """Persist a simulation record (upsert by simulation_id), owned by org_id."""
        ...

    def get_simulation(self, simulation_id: str, org_id: str) -> SimRecord | None:
        """Return the simulation record, or ``None`` if not found OR not owned by org_id."""
        ...

    def list_simulations(
        self, org_id: str, limit: int = 20, before: datetime | None = None
    ) -> list[SimRecord]:
        """Return org_id's simulations in reverse-chronological order.

        Parameters
        ----------
        org_id : str
            Only simulations owned by this organization are returned.
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

    def save_rocket(self, rec: RocketRecord, org_id: str) -> None:
        """Upsert a rocket record keyed by ``rocket_id``.

        Raises ``ValueError`` if *rec.org_id* disagrees with the explicit
        *org_id* argument — the two must always come from the same identity.
        """
        if rec.org_id != org_id:
            raise ValueError(
                f"RocketRecord.org_id ({rec.org_id!r}) does not match org_id ({org_id!r})."
            )
        self._rockets[rec.rocket_id] = rec

    def get_rocket(self, rocket_id: str, org_id: str) -> RocketRecord | None:
        """Return the rocket record, or ``None`` if absent or owned by another org."""
        rec = self._rockets.get(rocket_id)
        if rec is None or rec.org_id != org_id:
            return None
        return rec

    def list_rockets(
        self, org_id: str, limit: int = 20, before: datetime | None = None
    ) -> list[RocketRecord]:
        """Return org_id's rockets reverse-chronologically, optionally from cursor."""
        records = sorted(
            (r for r in self._rockets.values() if r.org_id == org_id),
            key=lambda r: r.created_at,
            reverse=True,
        )
        if before is not None:
            records = [r for r in records if r.created_at < before]
        return records[:limit]

    # ------------------------------------------------------------------
    # Simulation operations
    # ------------------------------------------------------------------

    def save_simulation(self, rec: SimRecord, org_id: str) -> None:
        """Upsert a simulation record keyed by ``simulation_id``.

        Raises ``ValueError`` if *rec.org_id* disagrees with the explicit
        *org_id* argument — the two must always come from the same identity.
        """
        if rec.org_id != org_id:
            raise ValueError(
                f"SimRecord.org_id ({rec.org_id!r}) does not match org_id ({org_id!r})."
            )
        self._simulations[rec.simulation_id] = rec

    def get_simulation(self, simulation_id: str, org_id: str) -> SimRecord | None:
        """Return the simulation record, or ``None`` if absent or owned by another org."""
        rec = self._simulations.get(simulation_id)
        if rec is None or rec.org_id != org_id:
            return None
        return rec

    def list_simulations(
        self, org_id: str, limit: int = 20, before: datetime | None = None
    ) -> list[SimRecord]:
        """Return org_id's simulations reverse-chronologically, optionally from cursor."""
        records = sorted(
            (r for r in self._simulations.values() if r.org_id == org_id),
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

    def save_rocket(self, rec: RocketRecord, org_id: str) -> None:
        """Write rocket metadata to Firestore collection ``rockets``.

        Raises ``ValueError`` if *rec.org_id* disagrees with the explicit
        *org_id* argument — the two must always come from the same identity.

        The ``manifest`` (the full ``parameters.json``) is intentionally NOT
        persisted to Firestore. It can contain arrays nested directly inside
        arrays (e.g. ``freeform_fins[].shape_points``), which Firestore Native
        rejects with ``400 InvalidArgument: Property manifest contains an
        invalid nested entity``. The manifest is already stored verbatim in
        object storage at ``{export_prefix}parameters.json`` and is served from
        there by the rocket-detail endpoint — so Firestore holds metadata only.
        """
        if rec.org_id != org_id:
            raise ValueError(
                f"RocketRecord.org_id ({rec.org_id!r}) does not match org_id ({org_id!r})."
            )
        doc = asdict(rec)
        doc.pop("manifest", None)
        doc["created_at"] = rec.created_at  # keep as datetime; Firestore handles it
        self._db.collection("rockets").document(rec.rocket_id).set(doc)

    def get_rocket(self, rocket_id: str, org_id: str) -> RocketRecord | None:
        """Fetch a single rocket document, or ``None`` if absent or owned by another org."""
        snap = self._db.collection("rockets").document(rocket_id).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        if d.get("org_id") != org_id:
            return None
        return RocketRecord(
            rocket_id=rocket_id,
            name=d.get("name", ""),
            created_at=d.get("created_at", datetime.now(timezone.utc)),
            created_by=d.get("created_by", ""),
            org_id=d.get("org_id", ""),
            export_prefix=d.get("export_prefix", ""),
            manifest=d.get("manifest", {}),
            gcs_ref=d.get("gcs_ref", ""),
            ork_filename=d.get("ork_filename"),
            has_source_ork=d.get("has_source_ork", False),
        )

    def list_rockets(
        self, org_id: str, limit: int = 20, before: datetime | None = None
    ) -> list[RocketRecord]:
        """Query org_id's rockets reverse-chronologically with optional cursor.

        Uses the ``"DESCENDING"`` direction string (accepted by all Firestore
        SDK versions) instead of importing ``Query.DESCENDING`` at call time —
        this keeps the method mockable without a live ``google`` package.

        Filtered + ordered by ``org_id`` and ``created_at`` — requires the
        composite index provisioned alongside the org_id backfill (issue #42).
        """
        q = (
            self._db.collection("rockets")
            .where("org_id", "==", org_id)
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
                    org_id=d.get("org_id", ""),
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

    def save_simulation(self, rec: SimRecord, org_id: str) -> None:
        """Write simulation document to Firestore collection ``simulations``.

        Raises ``ValueError`` if *rec.org_id* disagrees with the explicit
        *org_id* argument — the two must always come from the same identity.
        """
        if rec.org_id != org_id:
            raise ValueError(
                f"SimRecord.org_id ({rec.org_id!r}) does not match org_id ({org_id!r})."
            )
        doc = asdict(rec)
        doc["created_at"] = rec.created_at
        self._db.collection("simulations").document(rec.simulation_id).set(doc)

    def get_simulation(self, simulation_id: str, org_id: str) -> SimRecord | None:
        """Fetch a single simulation document, or ``None`` if absent or owned by another org."""
        snap = self._db.collection("simulations").document(simulation_id).get()
        if not snap.exists:
            return None
        d = snap.to_dict()
        if d.get("org_id") != org_id:
            return None
        return SimRecord(
            simulation_id=simulation_id,
            rocket_id=d.get("rocket_id", ""),
            scenario=d.get("scenario", {}),
            created_at=d.get("created_at", datetime.now(timezone.utc)),
            created_by=d.get("created_by", ""),
            org_id=d.get("org_id", ""),
            status=d.get("status", "done"),
            scalars=d.get("scalars", {}),
            warnings=d.get("warnings", []),
            result_prefix=d.get("result_prefix", ""),
            plot_names=d.get("plot_names", []),
            has_series=d.get("has_series", False),
            artifact_refs=d.get("artifact_refs", {}),
        )

    def list_simulations(
        self, org_id: str, limit: int = 20, before: datetime | None = None
    ) -> list[SimRecord]:
        """Query org_id's simulations reverse-chronologically with optional cursor.

        Uses ``"DESCENDING"`` direction string — same rationale as
        :meth:`list_rockets` (mockable without live ``google`` package).

        Filtered + ordered by ``org_id`` and ``created_at`` — requires the
        composite index provisioned alongside the org_id backfill (issue #42).
        """
        q = (
            self._db.collection("simulations")
            .where("org_id", "==", org_id)
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
                    org_id=d.get("org_id", ""),
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
