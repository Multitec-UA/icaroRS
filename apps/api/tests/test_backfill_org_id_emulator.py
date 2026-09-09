"""Firestore-emulator integration tests for the org_id backfill — issue #42.

Validates the real round-trip behaviour of ``backfill_collection`` against the
local Firestore emulator, mirroring ``test_firestore_emulator.py``'s pattern.

Requires:
- ``FIRESTORE_EMULATOR_HOST`` env var set (e.g. ``127.0.0.1:8085``)
- The Firestore emulator running at that host
- The ``[gcp]`` extra installed (``uv sync --extra gcp``)

Run:
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \\
    uv run --no-sync pytest -m integration tests/test_backfill_org_id_emulator.py -v
"""

from __future__ import annotations

import os

import pytest

from icaro_api.scripts.backfill_org_id import backfill_collection

pytestmark = pytest.mark.integration

_EMULATOR_HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "")

if not _EMULATOR_HOST:
    pytest.skip(
        "FIRESTORE_EMULATOR_HOST is not set — emulator tests skipped",
        allow_module_level=True,
    )


_PROJECT = "icaro-emulator-test"
_ORG_ID = "org-backfill-test"


@pytest.fixture(scope="module")
def client():
    """Real Firestore client pointing at the local emulator."""
    from google.cloud import firestore

    return firestore.Client(project=_PROJECT, database="(default)")


@pytest.fixture(autouse=True)
def _clear_collection(client) -> None:
    """Delete all documents in the scratch collection before each test."""
    col = client.collection("backfill_test_rockets")
    for doc in col.stream():
        doc.reference.delete()


class TestBackfillAgainstEmulator:
    def test_stamps_missing_org_id_and_leaves_existing_alone(self, client) -> None:
        col = client.collection("backfill_test_rockets")
        col.document("no-org").set({"name": "NoOrg"})
        col.document("has-org").set({"name": "HasOrg", "org_id": "org-other"})

        report = backfill_collection(client, "backfill_test_rockets", _ORG_ID)

        assert report.scanned == 2
        assert report.updated == 1
        assert report.already_stamped == 1

        assert col.document("no-org").get().to_dict()["org_id"] == _ORG_ID
        # A document that already had an org_id must never be overwritten.
        assert col.document("has-org").get().to_dict()["org_id"] == "org-other"

    def test_rerun_is_idempotent(self, client) -> None:
        col = client.collection("backfill_test_rockets")
        col.document("r1").set({"name": "A"})
        col.document("r2").set({"name": "B"})

        first = backfill_collection(client, "backfill_test_rockets", _ORG_ID)
        assert first.updated == 2

        second = backfill_collection(client, "backfill_test_rockets", _ORG_ID)
        assert second.scanned == 2
        assert second.updated == 0
        assert second.already_stamped == 2

        assert col.document("r1").get().to_dict()["org_id"] == _ORG_ID
        assert col.document("r2").get().to_dict()["org_id"] == _ORG_ID

    def test_dry_run_leaves_documents_untouched(self, client) -> None:
        col = client.collection("backfill_test_rockets")
        col.document("r1").set({"name": "A"})

        report = backfill_collection(client, "backfill_test_rockets", _ORG_ID, dry_run=True)

        assert report.updated == 1
        assert "org_id" not in col.document("r1").get().to_dict()

    def test_other_metadata_fields_survive_the_update(self, client) -> None:
        """update() must not clobber sibling fields — only add org_id."""
        col = client.collection("backfill_test_rockets")
        col.document("r1").set({"name": "KeepMe", "gcs_ref": "exports/r1/"})

        backfill_collection(client, "backfill_test_rockets", _ORG_ID)

        doc = col.document("r1").get().to_dict()
        assert doc["name"] == "KeepMe"
        assert doc["gcs_ref"] == "exports/r1/"
        assert doc["org_id"] == _ORG_ID
