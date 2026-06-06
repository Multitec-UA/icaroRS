"""Run-id scheme, run-directory helpers, and service dependency factories.

Every simulate call is assigned a unique ``run_id`` that:

* Is URL-safe (used as a path segment in ``/api/results/{run_id}/...``).
* Is chronologically sortable (timestamp prefix).
* Is collision-safe (short UUID suffix).
* Is forward-compatible with the Monte Carlo job model (NDJSON output drops
  into the same directory structure, per RG-9.7 / ADR-6).

Service adapters
----------------
``get_storage()`` and ``get_db()`` are FastAPI dependency functions that
return singleton service adapters selected by ``Settings``:

* ``gcs_bucket`` set → ``GcsStorage``; else ``LocalFsStorage`` (dev/CI).
* ``firestore_project`` set → ``FirestoreDb``; else ``InMemoryDb`` (dev/CI).

Singleton behaviour
-------------------
``get_db()`` returns a PROCESS-WIDE singleton for ``InMemoryDb`` so that
in-memory records created during one request (e.g. ``/api/convert``) are
visible to subsequent requests (e.g. ``/api/rockets``).  Tests that need an
isolated db simply override the dependency via
``app.dependency_overrides[get_db] = lambda: InMemoryDb()`` — FastAPI calls
the override directly and ``get_db`` is never invoked, so the singleton is
irrelevant to those tests.

``get_storage()`` uses ``LocalFsStorage`` which is STATELESS (all state lives
on disk).  A fresh instance per request is therefore functionally correct; no
singleton is required.  The function is NOT ``@lru_cache`` for the same reason
as ``get_db``: tests override via ``dependency_overrides`` and never reach the
real function.

Usage
-----
>>> from icaro_api.runs import make_run_id, make_run_dir, get_storage, get_db
>>> run_id = make_run_id()
>>> run_dir = make_run_dir(base_dir, run_id)
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import Depends

from icaro_api.config import Settings, get_settings

if TYPE_CHECKING:
    from icaro_api.services.db import Db
    from icaro_api.services.storage import Storage


def make_run_id() -> str:
    """Generate a new run id: ``{utc-timestamp}-{short-uuid}``.

    Returns
    -------
    str
        E.g. ``20260529T183000Z-a1b2c3d4``
    """
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    short = uuid.uuid4().hex[:8]
    return f"{ts}-{short}"


def make_run_dir(base_dir: Path, run_id: str) -> Path:
    """Create and return ``{base_dir}/{run_id}/``.

    Parameters
    ----------
    base_dir : Path
        Root results directory (from ``Settings.results_dir``).
    run_id : str
        Unique run identifier (from :func:`make_run_id`).

    Returns
    -------
    Path
        The newly created directory path.
    """
    run_dir = base_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def resolve_run_dir(base_dir: Path, run_id: str) -> Path | None:
    """Return the run directory if it exists, else ``None``.

    Parameters
    ----------
    base_dir : Path
        Root results directory.
    run_id : str
        Run id to look up.

    Returns
    -------
    Path | None
    """
    run_dir = base_dir / run_id
    return run_dir if run_dir.is_dir() else None


# ---------------------------------------------------------------------------
# Service dependency factories — mirroring get_settings() singleton pattern
# ---------------------------------------------------------------------------

# Process-wide singleton for the dev/CI InMemoryDb adapter.  Set to None at
# module load; lazily initialised on first get_db() call without firestore.
# Reset to None in tests that exercise the real get_db() to keep isolation.
_inmemory_db: "Db | None" = None


def get_storage(settings: Settings = Depends(get_settings)) -> "Storage":
    """FastAPI dependency: return the Storage adapter for this process.

    Adapter selection (Design §Architecture Decisions):

    * ``Settings.gcs_bucket`` is set → ``GcsStorage(bucket_name)``
    * Otherwise → ``LocalFsStorage(settings.results_dir / "blobs")``
      (dev/CI only — NEVER use this path in production without gcs_bucket set)

    ``LocalFsStorage`` is STATELESS — all persistent state lives on disk, not
    in the instance.  A fresh instance per request is therefore safe and there
    is no need for a singleton here.  Tests override via
    ``app.dependency_overrides[get_storage]``, so caching would be irrelevant
    anyway.

    Parameters
    ----------
    settings : Settings
        Injected via ``Depends(get_settings)``.

    Returns
    -------
    Storage
        Configured adapter instance.
    """
    from icaro_api.services.storage import GcsStorage, LocalFsStorage

    if settings.gcs_bucket:
        return GcsStorage(settings.gcs_bucket)
    blob_root = settings.results_dir / "blobs"
    blob_root.mkdir(parents=True, exist_ok=True)
    return LocalFsStorage(blob_root)


def get_db(settings: Settings = Depends(get_settings)) -> "Db":
    """FastAPI dependency: return the Db adapter for this process.

    Adapter selection (Design §Architecture Decisions):

    * ``Settings.firestore_project`` is set → ``FirestoreDb(project, database)``
    * Otherwise → the process-wide ``InMemoryDb`` singleton (dev/CI only)

    The singleton is REQUIRED for ``InMemoryDb`` because its state lives in
    the instance dict.  Returning a fresh instance per request (the previous
    behaviour) caused records written during one request to be invisible to
    subsequent requests — a silent data-loss bug in dev/CI.

    ``FirestoreDb`` is NOT cached here — Firestore state lives in the remote
    database, so each request getting a fresh client handle is correct.

    Tests override via ``app.dependency_overrides[get_db] = lambda: db``;
    FastAPI resolves the override directly and never calls this function, so
    the singleton has zero impact on test isolation.

    Parameters
    ----------
    settings : Settings
        Injected via ``Depends(get_settings)``.

    Returns
    -------
    Db
        Configured adapter instance.
    """
    global _inmemory_db
    from icaro_api.services.db import FirestoreDb, InMemoryDb

    if settings.firestore_project:
        return FirestoreDb(
            project=settings.firestore_project,
            database=settings.firestore_database,
        )
    if _inmemory_db is None:
        _inmemory_db = InMemoryDb()
    return _inmemory_db
