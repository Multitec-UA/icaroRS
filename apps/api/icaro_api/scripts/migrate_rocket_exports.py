"""Migrate the pre-split ``rockets`` collection into ``rockets`` + ``exports``.

Before the Rocket/Export split, every converted ``.ork`` was one document in
``rockets`` (id == convert run id == ``export_id``). Now a *rocket* groups the
files a team uploads and each converted file is an *export* in its own
collection, attached through ``rocket_id``.

For every legacy ``rockets/{id}`` document (recognised by its ``export_prefix``
field, which only exports carry) this script:

1. writes ``exports/{id}`` with all the legacy fields plus ``export_id = id``
   and ``rocket_id = id`` — the legacy id is reused for both the new rocket and
   its single export, so existing ``simulations.rocket_id`` values stay valid
   rocket references and clients holding an old id keep working;
2. rewrites ``rockets/{id}`` in place to the new shape (``rocket_id``, ``name``,
   ``org_id``, ``created_by``, ``created_at``) with ``set`` so the export-only
   fields disappear.

For every ``simulations`` document without an ``export_id`` it sets
``export_id = rocket_id`` (the legacy id was the export).

Idempotent by construction: documents already in the new shape are counted
and skipped, so re-running (including resuming a partial run) reports
``migrated=0``. Run it **before** deploying the API that reads ``exports``.

Usage
-----
    ICARO_FIRESTORE_PROJECT=my-project \\
        uv run python -m icaro_api.scripts.migrate_rocket_exports [--dry-run]

    uv run python -m icaro_api.scripts.migrate_rocket_exports \\
        --project my-project [--database "(default)"] [--dry-run]

Requires the ``[gcp]`` extra (``uv sync --extra gcp``) and Application
Default Credentials with ``roles/datastore.user`` on the target project.
Also create the new composite indexes in ``firestore.indexes.json`` (see
``DEPLOY.md``) — the ``exports`` queries fail at runtime without them.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from typing import Any

# Must match the collection names FirestoreDb reads/writes (icaro_api.services.db).
ROCKETS_COLLECTION = "rockets"
EXPORTS_COLLECTION = "exports"
SIMULATIONS_COLLECTION = "simulations"

# Fields a rocket (group) keeps; everything else on a legacy doc is export data.
ROCKET_FIELDS: tuple[str, ...] = ("rocket_id", "name", "created_at", "created_by", "org_id")

# Firestore caps a single batch at 500 writes; stay comfortably under that.
_BATCH_LIMIT = 400


@dataclass
class MigrationReport:
    """Scanned/migrated/already-migrated counts for one collection."""

    collection: str
    scanned: int = 0
    migrated: int = 0
    already_migrated: int = 0

    def __str__(self) -> str:
        return (
            f"{self.collection}: scanned={self.scanned} "
            f"migrated={self.migrated} already_migrated={self.already_migrated}"
        )


def rocket_doc_from_legacy(doc_id: str, legacy: dict[str, Any]) -> dict[str, Any]:
    """Project a legacy per-file document onto the new rocket (group) shape."""
    doc = {k: legacy[k] for k in ROCKET_FIELDS if k in legacy}
    doc["rocket_id"] = legacy.get("rocket_id") or doc_id
    return doc


class _Batcher:
    """Commit a Firestore write batch every ``_BATCH_LIMIT`` writes.

    Committing as batches fill means a partial run leaves already-committed
    documents migrated and safe to resume; nothing is buffered until the end.
    """

    def __init__(self, client, *, dry_run: bool) -> None:
        self._client = client
        self._dry_run = dry_run
        self._batch = None if dry_run else client.batch()
        self._pending = 0

    def set(self, ref, doc: dict[str, Any]) -> None:
        if self._dry_run:
            return
        self._batch.set(ref, doc)
        self._tick()

    def update(self, ref, fields: dict[str, Any]) -> None:
        if self._dry_run:
            return
        self._batch.update(ref, fields)
        self._tick()

    def _tick(self) -> None:
        self._pending += 1
        if self._pending >= _BATCH_LIMIT:
            self._batch.commit()
            self._batch = self._client.batch()
            self._pending = 0

    def flush(self) -> None:
        if not self._dry_run and self._pending:
            self._batch.commit()
            self._pending = 0


def migrate_rockets(
    client,
    *,
    dry_run: bool = False,
    rockets_collection: str = ROCKETS_COLLECTION,
    exports_collection: str = EXPORTS_COLLECTION,
) -> MigrationReport:
    """Split every legacy ``rockets`` document into an export plus a rewritten rocket.

    Firestore has no reliable "field is absent" filter, so this scans every
    document and checks ``export_prefix`` in Python — correct regardless of
    collection size.
    """
    report = MigrationReport(collection=rockets_collection)
    batcher = _Batcher(client, dry_run=dry_run)

    for snap in client.collection(rockets_collection).stream():
        report.scanned += 1
        legacy = snap.to_dict() or {}
        if "export_prefix" not in legacy:
            report.already_migrated += 1
            continue

        report.migrated += 1
        export_doc = {**legacy, "export_id": snap.id, "rocket_id": snap.id}
        batcher.set(client.collection(exports_collection).document(snap.id), export_doc)
        batcher.set(snap.reference, rocket_doc_from_legacy(snap.id, legacy))

    batcher.flush()
    return report


def migrate_simulations(
    client, *, dry_run: bool = False, collection: str = SIMULATIONS_COLLECTION
) -> MigrationReport:
    """Set ``export_id = rocket_id`` on every simulation that lacks one."""
    report = MigrationReport(collection=collection)
    batcher = _Batcher(client, dry_run=dry_run)

    for snap in client.collection(collection).stream():
        report.scanned += 1
        data = snap.to_dict() or {}
        if data.get("export_id"):
            report.already_migrated += 1
            continue

        report.migrated += 1
        batcher.update(snap.reference, {"export_id": data.get("rocket_id", "")})

    batcher.flush()
    return report


def run_migration(project: str, database: str, *, dry_run: bool = False) -> list[MigrationReport]:
    """Run both steps against the given Firestore database."""
    from google.cloud import firestore  # type: ignore[import]

    client = firestore.Client(project=project, database=database)
    return [
        migrate_rockets(client, dry_run=dry_run),
        migrate_simulations(client, dry_run=dry_run),
    ]


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--project",
        default=os.environ.get("ICARO_FIRESTORE_PROJECT"),
        help="GCP project id (required; or set ICARO_FIRESTORE_PROJECT).",
    )
    parser.add_argument(
        "--database",
        default=os.environ.get("ICARO_FIRESTORE_DATABASE", "(default)"),
        help='Firestore database name (default "(default)"; or set ICARO_FIRESTORE_DATABASE).',
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Scan and report what would change without writing anything.",
    )
    args = parser.parse_args(argv)
    if not args.project:
        parser.error("--project is required (or set ICARO_FIRESTORE_PROJECT)")
    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    reports = run_migration(args.project, args.database, dry_run=args.dry_run)
    prefix = "[dry-run] " if args.dry_run else ""
    for report in reports:
        print(f"{prefix}{report}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
