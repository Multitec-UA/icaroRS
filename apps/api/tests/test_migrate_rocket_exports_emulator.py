"""Firestore-emulator integration tests for the rockets → exports migration (S3).

Validates the real round-trip of ``migrate_rockets`` / ``migrate_simulations``
against the local Firestore emulator, mirroring ``test_backfill_org_id_emulator.py``.

Run:
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \\
    uv run --no-sync pytest -m integration tests/test_migrate_rocket_exports_emulator.py -v
"""

from __future__ import annotations

import os
from datetime import datetime, timezone

import pytest

from icaro_api.scripts.migrate_rocket_exports import migrate_rockets, migrate_simulations

pytestmark = pytest.mark.integration

_EMULATOR_HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "")

if not _EMULATOR_HOST:
    pytest.skip(
        "FIRESTORE_EMULATOR_HOST is not set — emulator tests skipped",
        allow_module_level=True,
    )

_PROJECT = "icaro-emulator-test"
_ROCKETS = "migrate_test_rockets"
_EXPORTS = "migrate_test_exports"
_SIMS = "migrate_test_simulations"
_T1 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def client():
    from google.cloud import firestore

    return firestore.Client(project=_PROJECT, database="(default)")


@pytest.fixture(autouse=True)
def _clear(client) -> None:
    for name in (_ROCKETS, _EXPORTS, _SIMS):
        for doc in client.collection(name).stream():
            doc.reference.delete()


def _legacy(doc_id: str) -> dict:
    return {
        "rocket_id": doc_id,
        "name": "Icarus",
        "created_at": _T1,
        "created_by": "u1",
        "org_id": "org-1",
        "export_prefix": f"orgs/org-1/exports/{doc_id}/",
        "gcs_ref": f"orgs/org-1/exports/{doc_id}/",
        "ork_filename": "icarus.ork",
        "has_source_ork": False,
    }


class TestMigrateAgainstEmulator:
    def test_legacy_rocket_is_split_and_rerun_is_noop(self, client) -> None:
        client.collection(_ROCKETS).document("r1").set(_legacy("r1"))
        client.collection(_ROCKETS).document("r-new").set(
            {"rocket_id": "r-new", "name": "Fresh", "created_at": _T1, "created_by": "u", "org_id": "org-1"}
        )

        report = migrate_rockets(client, rockets_collection=_ROCKETS, exports_collection=_EXPORTS)

        assert (report.scanned, report.migrated, report.already_migrated) == (2, 1, 1)
        export = client.collection(_EXPORTS).document("r1").get().to_dict()
        assert export["export_id"] == "r1" and export["rocket_id"] == "r1"
        assert export["export_prefix"] == "orgs/org-1/exports/r1/"
        assert export["ork_filename"] == "icarus.ork"
        rocket = client.collection(_ROCKETS).document("r1").get().to_dict()
        assert set(rocket) == {"rocket_id", "name", "created_at", "created_by", "org_id"}
        assert rocket["name"] == "Icarus"

        again = migrate_rockets(client, rockets_collection=_ROCKETS, exports_collection=_EXPORTS)
        assert again.migrated == 0 and again.already_migrated == 2

    def test_dry_run_leaves_documents_untouched(self, client) -> None:
        client.collection(_ROCKETS).document("r1").set(_legacy("r1"))

        report = migrate_rockets(client, dry_run=True, rockets_collection=_ROCKETS, exports_collection=_EXPORTS)

        assert report.migrated == 1
        assert not client.collection(_EXPORTS).document("r1").get().exists
        assert "export_prefix" in client.collection(_ROCKETS).document("r1").get().to_dict()

    def test_simulations_gain_export_id(self, client) -> None:
        client.collection(_SIMS).document("s1").set({"rocket_id": "r1", "org_id": "org-1", "status": "done"})
        client.collection(_SIMS).document("s2").set({"rocket_id": "r2", "export_id": "e2", "org_id": "org-1"})

        report = migrate_simulations(client, collection=_SIMS)

        assert (report.migrated, report.already_migrated) == (1, 1)
        s1 = client.collection(_SIMS).document("s1").get().to_dict()
        assert s1["export_id"] == "r1" and s1["status"] == "done"
        assert client.collection(_SIMS).document("s2").get().to_dict()["export_id"] == "e2"
