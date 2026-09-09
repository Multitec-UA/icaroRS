"""Backfill ``org_id`` onto existing Firestore ``rockets``/``simulations`` docs.

Issue #42. Every document written before organizations existed carries no
``org_id`` field. Once the ``Db`` protocol starts filtering by organization
(issue #43), any document missing that field becomes invisible — indistin-
guishable from data loss. This script stamps a given organization id onto
every pre-existing document that lacks one, so it must run (and this PR must
merge) **before** #43 lands.

It does **not** create the organization in Identity Platform — that belongs
to #41. The org id is only ever taken from ``--org-id`` / ``ICARO_BACKFILL_ORG_ID``;
never hardcoded here.

Idempotent by construction: a document is only touched when it has no truthy
``org_id`` yet, so re-running (including resuming a partially-completed run)
just reports ``updated=0`` for anything already stamped.

Usage
-----
    ICARO_FIRESTORE_PROJECT=my-project ICARO_BACKFILL_ORG_ID=org-abc \\
        uv run python -m icaro_api.scripts.backfill_org_id

    uv run python -m icaro_api.scripts.backfill_org_id \\
        --project my-project --org-id org-abc [--database "(default)"] [--dry-run]

Requires the ``[gcp]`` extra (``uv sync --extra gcp``) and Application
Default Credentials with ``roles/datastore.user`` on the target project.
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass

# Must match the collection names FirestoreDb writes to (icaro_api.services.db).
COLLECTIONS: tuple[str, ...] = ("rockets", "simulations")

# Firestore caps a single batch at 500 writes; stay comfortably under that.
_BATCH_LIMIT = 400


@dataclass
class BackfillReport:
    """Scanned/updated/already-stamped counts for one collection."""

    collection: str
    scanned: int = 0
    updated: int = 0
    already_stamped: int = 0

    def __str__(self) -> str:
        return (
            f"{self.collection}: scanned={self.scanned} "
            f"updated={self.updated} already_stamped={self.already_stamped}"
        )


def backfill_collection(
    client, collection: str, org_id: str, *, dry_run: bool = False
) -> BackfillReport:
    """Stamp ``org_id`` onto every document in *collection* that lacks one.

    Firestore has no reliable "field is absent" query filter, so this scans
    every document and checks the field in Python — correct regardless of
    collection size, and the only way to guarantee no document is missed.
    Writes are batched (``_BATCH_LIMIT`` per batch, committed as they fill)
    so a partial run leaves already-committed batches stamped and safe to
    resume; nothing is buffered only in memory until the end.
    """
    report = BackfillReport(collection=collection)
    batch = client.batch()
    pending = 0

    for snap in client.collection(collection).stream():
        report.scanned += 1
        data = snap.to_dict() or {}
        if data.get("org_id"):
            report.already_stamped += 1
            continue

        report.updated += 1
        if dry_run:
            continue

        batch.update(snap.reference, {"org_id": org_id})
        pending += 1
        if pending >= _BATCH_LIMIT:
            batch.commit()
            batch = client.batch()
            pending = 0

    if pending:
        batch.commit()

    return report


def run_backfill(
    project: str, database: str, org_id: str, *, dry_run: bool = False
) -> list[BackfillReport]:
    """Run the backfill against every collection in ``COLLECTIONS``."""
    from google.cloud import firestore  # type: ignore[import]

    client = firestore.Client(project=project, database=database)
    return [
        backfill_collection(client, collection, org_id, dry_run=dry_run)
        for collection in COLLECTIONS
    ]


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--org-id",
        default=os.environ.get("ICARO_BACKFILL_ORG_ID"),
        help="Organization id to stamp (required; or set ICARO_BACKFILL_ORG_ID). "
        "Never hardcoded — this script does not create the organization.",
    )
    parser.add_argument(
        "--project",
        default=os.environ.get("ICARO_FIRESTORE_PROJECT"),
        help="GCP project id (required; or set ICARO_FIRESTORE_PROJECT).",
    )
    parser.add_argument(
        "--database",
        default=os.environ.get("ICARO_FIRESTORE_DATABASE", "(default)"),
        help='Firestore database name (default: "(default)").',
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing anything.",
    )
    args = parser.parse_args(argv)

    if not args.org_id:
        parser.error("--org-id is required (or set ICARO_BACKFILL_ORG_ID)")
    if not args.project:
        parser.error("--project is required (or set ICARO_FIRESTORE_PROJECT)")

    return args


def main(argv: list[str] | None = None) -> int:
    args = _parse_args(argv)
    reports = run_backfill(
        args.project, args.database, args.org_id, dry_run=args.dry_run
    )

    for report in reports:
        print(report)

    total = BackfillReport(collection="TOTAL")
    for report in reports:
        total.scanned += report.scanned
        total.updated += report.updated
        total.already_stamped += report.already_stamped
    print(total)

    if args.dry_run:
        print("(dry run — no documents were modified)")

    return 0


if __name__ == "__main__":
    sys.exit(main())
