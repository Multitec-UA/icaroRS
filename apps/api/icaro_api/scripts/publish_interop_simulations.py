"""Publish existing simulations to ``interop_simulations`` (real flight interop).

New runs of the organisations in ``ICARO_INTEROP_ORGS`` are published by
``POST /api/simulate`` itself. This script covers the runs made before that:
for every ``done`` simulation of each allowed organisation it builds the
``mt-interop/simulation@1`` document from what the run stored (its
``interop.json``, or, for runs older than that artefact, an approximate
payload from ``series.json`` and the scalars, flagged ``approximate: true``)
and upserts it under the run's id.

Dry run by default: it reports what it would publish and writes nothing.
``--apply`` writes. Idempotent by construction: the document id is the
run id and its content comes from stored artefacts, so re-running rewrites the
same documents (only ``updated_at`` moves). It never re-simulates.

Usage
-----
    ICARO_FIRESTORE_PROJECT=my-project ICARO_GCS_BUCKET=my-bucket \\
    ICARO_INTEROP_ORGS=org-abc \\
        uv run python -m icaro_api.scripts.publish_interop_simulations [--apply]

    uv run python -m icaro_api.scripts.publish_interop_simulations \\
        --org-id org-abc [--org-id org-def] [--limit 50] [--apply]

Reads the same settings as the API (``ICARO_*`` environment variables:
Firestore project and database, GCS bucket). Requires the ``[gcp]`` extra
and Application Default Credentials with ``roles/datastore.user`` and read
access to the results bucket.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime

from icaro import InteropSchemaError

#: Simulations read per page from the Db.
_PAGE = 100


@dataclass
class PublishReport:
    """What happened to each run of one organisation."""

    org_id: str
    scanned: int = 0
    published: int = 0
    approximate: int = 0
    skipped: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"{self.org_id}: scanned={self.scanned} published={self.published} "
            f"(approximate={self.approximate}) skipped={len(self.skipped)}"
        )


def _iter_simulations(db, org_id: str, limit: int | None):
    """Every simulation of *org_id*, newest first, through the cursor pages."""
    before: datetime | None = None
    seen = 0
    while True:
        page = db.list_simulations(org_id=org_id, limit=_PAGE, before=before)
        for rec in page:
            yield rec
            seen += 1
            if limit is not None and seen >= limit:
                return
        if len(page) < _PAGE:
            return
        before = page[-1].created_at


def _motor(storage, export) -> str | None:
    from icaro_api.services.interop import motor_label

    if export is None or not export.export_prefix:
        return None
    try:
        return motor_label(json.loads(storage.open_blob(f"{export.export_prefix}parameters.json")))
    except Exception:  # noqa: BLE001 - the motor is a label only
        return None


def publish_org(
    db, storage, store, org_id: str, *, apply: bool = False, limit: int | None = None
) -> PublishReport:
    """Publish (or, without *apply*, only check) every done run of *org_id*."""
    from icaro_api.services.interop import build_simulation_doc, load_run_payload

    report = PublishReport(org_id=org_id)
    rockets: dict[str, object] = {}
    exports: dict[str, object] = {}

    for sim in _iter_simulations(db, org_id, limit):
        report.scanned += 1
        if sim.status != "done":
            report.skipped.append(f"{sim.simulation_id}: status {sim.status}")
            continue
        try:
            payload = load_run_payload(storage, sim)
        except (LookupError, InteropSchemaError) as exc:
            report.skipped.append(f"{sim.simulation_id}: {exc}")
            continue

        if sim.rocket_id not in rockets:
            rockets[sim.rocket_id] = db.get_rocket(sim.rocket_id, org_id=org_id)
        if sim.export_id and sim.export_id not in exports:
            exports[sim.export_id] = db.get_export(sim.export_id, org_id=org_id)
        rocket = rockets.get(sim.rocket_id)
        export = exports.get(sim.export_id) if sim.export_id else None

        doc = build_simulation_doc(
            payload,
            sim=sim,
            rocket_name=getattr(rocket, "name", None),
            export_label=(getattr(export, "ork_filename", None) or getattr(export, "name", None)),
            motor=_motor(storage, export),
        )
        if apply:
            store.publish_simulation(doc)
        report.published += 1
        if doc.get("approximate"):
            report.approximate += 1
    return report


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--org-id",
        action="append",
        default=None,
        help="Organisation to publish (repeatable). Default: every id in ICARO_INTEROP_ORGS. "
        "Each one must be in ICARO_INTEROP_ORGS.",
    )
    parser.add_argument("--limit", type=int, default=None, help="At most this many runs per organisation.")
    parser.add_argument(
        "--apply", action="store_true", help="Write the documents (default: dry run, nothing is written)."
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    from icaro_api.config import Settings
    from icaro_api.runs import get_db, get_interop_store, get_storage
    from icaro_api.services.interop import interop_org_ids

    args = _parse_args(argv)
    settings = Settings()
    allowed = interop_org_ids(settings.interop_orgs)
    orgs = args.org_id or sorted(allowed)
    if not orgs:
        print("ICARO_INTEROP_ORGS is empty: the real flight interop is off, nothing to publish.")
        return 1
    refused = [o for o in orgs if o not in allowed]
    if refused:
        print(f"Not in ICARO_INTEROP_ORGS, refused: {', '.join(refused)}")
        return 2
    if not settings.firestore_project:
        print("ICARO_FIRESTORE_PROJECT is not set: there is no shared database to publish to.")
        return 2

    db = get_db(settings)
    storage = get_storage(settings)
    store = get_interop_store(settings)
    for org_id in orgs:
        report = publish_org(db, storage, store, org_id, apply=args.apply, limit=args.limit)
        print(report)
        for line in report.skipped:
            print(f"  skipped {line}")
    if not args.apply:
        print("(dry run: nothing was written; pass --apply to publish)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
