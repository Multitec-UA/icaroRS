"""Migrate the pre-split ``rockets`` collection into ``rockets`` + ``exports``.

Before the Rocket/Export split, every converted ``.ork`` was one document in
``rockets`` (id == convert run id == ``export_id``). Now a *rocket* groups the
files a team uploads and each converted file is an *export* in its own
collection, attached through ``rocket_id``.

For every legacy ``rockets/{id}`` document (recognised by its ``export_prefix``
field, which only exports carry, and no ``schema_version`` marker) this script:

1. writes ``exports/{id}`` with all the legacy fields plus ``export_id = id``
   and ``rocket_id = id`` — the legacy id is reused for both the new rocket and
   its single export, so existing ``simulations.rocket_id`` values stay valid
   rocket references and clients holding an old id keep working;
2. marks ``rockets/{id}`` with ``schema_version = 2`` and **keeps every legacy
   field in place**. The pre-split API reads ``export_prefix`` from that
   document, and it is still serving traffic during the migrate-then-deploy
   window and after any rollback; the new API ignores the extra fields. So the
   migration is safe to run while the old API is up, and rolling back needs
   no data change.

For every ``simulations`` document without an ``export_id`` it sets
``export_id = rocket_id`` (the legacy id was the export).

Once the new API is deployed and a rollback is no longer on the table, run
it again with ``--drop-legacy-fields`` to remove the export-only fields
(``export_prefix``, ``gcs_ref``, ``ork_filename``, ``has_source_ork``,
``manifest``) from the marked rocket documents.

Idempotent by construction: marked documents and new-shape documents are
counted and skipped, so re-running (including resuming a partial run) reports
``migrated=0``; the cleanup skips documents that have nothing left to drop.

Usage
-----
    ICARO_FIRESTORE_PROJECT=my-project \\
        uv run python -m icaro_api.scripts.migrate_rocket_exports [--dry-run]

    uv run python -m icaro_api.scripts.migrate_rocket_exports \\
        --project my-project [--database "(default)"] [--dry-run] [--drop-legacy-fields]

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
# Export-only fields a legacy rocket document carries; removed by --drop-legacy-fields.
LEGACY_EXPORT_FIELDS: tuple[str, ...] = (
    "export_prefix",
    "gcs_ref",
    "ork_filename",
    "has_source_ork",
    "manifest",
)
# Marker written on migrated rocket documents (absent == 1, the pre-split shape).
ROCKET_SCHEMA_VERSION = 2

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


def _delete_field():
    """Firestore's field-deletion sentinel, imported lazily (needs the ``gcp`` extra)."""
    from google.cloud import firestore  # type: ignore[import]

    return firestore.DELETE_FIELD


def is_legacy_rocket(doc: dict[str, Any]) -> bool:
    """A pre-split per-file document: carries export data and no schema marker."""
    return "export_prefix" in doc and doc.get("schema_version", 1) < ROCKET_SCHEMA_VERSION


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
    """Give every legacy ``rockets`` document its export and mark it migrated.

    The rocket document is only *marked* (``schema_version = 2``); its legacy
    export fields stay so the pre-split API keeps working until the cleanup
    pass (see :func:`drop_legacy_rocket_fields`).

    Firestore has no reliable "field is absent" filter, so this scans every
    document and checks the shape in Python — correct regardless of
    collection size.
    """
    report = MigrationReport(collection=rockets_collection)
    batcher = _Batcher(client, dry_run=dry_run)

    for snap in client.collection(rockets_collection).stream():
        report.scanned += 1
        legacy = snap.to_dict() or {}
        if not is_legacy_rocket(legacy):
            report.already_migrated += 1
            continue

        report.migrated += 1
        export_doc = {**legacy, "export_id": snap.id, "rocket_id": snap.id}
        batcher.set(client.collection(exports_collection).document(snap.id), export_doc)
        batcher.update(snap.reference, {"schema_version": ROCKET_SCHEMA_VERSION})

    batcher.flush()
    return report


def drop_legacy_rocket_fields(
    client, *, dry_run: bool = False, rockets_collection: str = ROCKETS_COLLECTION
) -> MigrationReport:
    """Remove the export-only fields from migrated (marked) rocket documents.

    Run only once the pre-split API can no longer come back: it is the only
    reader of those fields. Unmarked legacy documents are left alone (migrate
    them first); documents with nothing left to drop are counted as done.
    """
    report = MigrationReport(collection=f"{rockets_collection} (legacy fields)")
    batcher = _Batcher(client, dry_run=dry_run)
    delete = None

    for snap in client.collection(rockets_collection).stream():
        report.scanned += 1
        doc = snap.to_dict() or {}
        stale = [f for f in LEGACY_EXPORT_FIELDS if f in doc]
        if doc.get("schema_version", 1) < ROCKET_SCHEMA_VERSION or not stale:
            report.already_migrated += 1
            continue

        report.migrated += 1
        if dry_run:
            continue
        if delete is None:
            delete = _delete_field()
        batcher.update(snap.reference, {f: delete for f in stale})

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


def run_migration(
    project: str, database: str, *, dry_run: bool = False, drop_legacy_fields: bool = False
) -> list[MigrationReport]:
    """Run the migration (and, on request, the cleanup) against the given database."""
    from google.cloud import firestore  # type: ignore[import]

    client = firestore.Client(project=project, database=database)
    reports = [
        migrate_rockets(client, dry_run=dry_run),
        migrate_simulations(client, dry_run=dry_run),
    ]
    if drop_legacy_fields:
        reports.append(drop_legacy_rocket_fields(client, dry_run=dry_run))
    return reports


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
    parser.add_argument(
        "--drop-legacy-fields",
        action="store_true",
        help=(
            "Also remove the export-only fields from migrated rocket documents. "
            "Only after the new API is deployed and a rollback is no longer possible: "
            "the pre-split API reads those fields."
        ),
    )
    args = parser.parse_args(argv)
    if not args.project:
        parser.error("--project is required (or set ICARO_FIRESTORE_PROJECT)")
    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    reports = run_migration(
        args.project, args.database, dry_run=args.dry_run, drop_legacy_fields=args.drop_legacy_fields
    )
    prefix = "[dry-run] " if args.dry_run else ""
    for report in reports:
        print(f"{prefix}{report}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
