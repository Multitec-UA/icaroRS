"""Unit tests for the org_id backfill script — issue #42.

Mocks the Firestore client the same way ``test_services_firestore_db.py``
does — zero live GCP dependency. Emulator-backed round-trip coverage lives in
``test_backfill_org_id_emulator.py``.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from icaro_api.scripts.backfill_org_id import (
    COLLECTIONS,
    BackfillReport,
    _parse_args,
    backfill_collection,
)


def _make_snap(doc_id: str, data: dict) -> MagicMock:
    snap = MagicMock()
    snap.id = doc_id
    snap.to_dict.return_value = data
    snap.reference = MagicMock(name=f"ref-{doc_id}")
    return snap


class TestBackfillCollection:
    def test_stamps_documents_missing_org_id(self):
        client = MagicMock()
        snaps = [_make_snap("r1", {"name": "A"}), _make_snap("r2", {"name": "B"})]
        client.collection.return_value.stream.return_value = snaps
        batch = client.batch.return_value

        report = backfill_collection(client, "rockets", "org-123")

        assert report.scanned == 2
        assert report.updated == 2
        assert report.already_stamped == 0
        assert batch.update.call_count == 2
        batch.update.assert_any_call(snaps[0].reference, {"org_id": "org-123"})
        batch.update.assert_any_call(snaps[1].reference, {"org_id": "org-123"})
        batch.commit.assert_called_once()

    def test_skips_documents_that_already_have_org_id(self):
        client = MagicMock()
        snaps = [
            _make_snap("r1", {"name": "A", "org_id": "org-123"}),
            _make_snap("r2", {"name": "B"}),
        ]
        client.collection.return_value.stream.return_value = snaps
        batch = client.batch.return_value

        report = backfill_collection(client, "rockets", "org-123")

        assert report.scanned == 2
        assert report.updated == 1
        assert report.already_stamped == 1
        batch.update.assert_called_once_with(snaps[1].reference, {"org_id": "org-123"})

    def test_empty_string_org_id_is_treated_as_missing(self):
        """A falsy org_id (e.g. an empty string from a bad prior write) is re-stamped."""
        client = MagicMock()
        snaps = [_make_snap("r1", {"name": "A", "org_id": ""})]
        client.collection.return_value.stream.return_value = snaps

        report = backfill_collection(client, "rockets", "org-123")

        assert report.updated == 1
        assert report.already_stamped == 0

    def test_idempotent_rerun_reports_zero_updates(self):
        """Simulates re-running after a full backfill: everything already stamped."""
        client = MagicMock()
        snaps = [
            _make_snap("r1", {"org_id": "org-123"}),
            _make_snap("r2", {"org_id": "org-123"}),
        ]
        client.collection.return_value.stream.return_value = snaps
        batch = client.batch.return_value

        report = backfill_collection(client, "rockets", "org-123")

        assert report.scanned == 2
        assert report.updated == 0
        assert report.already_stamped == 2
        batch.update.assert_not_called()
        batch.commit.assert_not_called()

    def test_dry_run_writes_nothing(self):
        client = MagicMock()
        snaps = [_make_snap("r1", {}), _make_snap("r2", {})]
        client.collection.return_value.stream.return_value = snaps
        batch = client.batch.return_value

        report = backfill_collection(client, "rockets", "org-123", dry_run=True)

        assert report.updated == 2
        batch.update.assert_not_called()
        batch.commit.assert_not_called()

    def test_partial_batch_is_committed_at_end(self):
        """A batch smaller than _BATCH_LIMIT still gets committed once, at the end."""
        client = MagicMock()
        snaps = [_make_snap(f"r{i}", {}) for i in range(3)]
        client.collection.return_value.stream.return_value = snaps
        batch = client.batch.return_value

        backfill_collection(client, "rockets", "org-123")

        assert batch.commit.call_count == 1

    def test_batch_boundary_commits_and_starts_a_fresh_batch(self, monkeypatch):
        """Crossing _BATCH_LIMIT commits mid-stream and continues on a new batch."""
        import icaro_api.scripts.backfill_org_id as mod

        monkeypatch.setattr(mod, "_BATCH_LIMIT", 2)

        client = MagicMock()
        snaps = [_make_snap(f"r{i}", {}) for i in range(5)]
        client.collection.return_value.stream.return_value = snaps
        first_batch = MagicMock()
        second_batch = MagicMock()
        third_batch = MagicMock()
        client.batch.side_effect = [first_batch, second_batch, third_batch]

        report = mod.backfill_collection(client, "rockets", "org-123")

        assert report.updated == 5
        # 2 full batches (2+2) committed mid-stream, plus the trailing 1.
        assert first_batch.commit.call_count == 1
        assert second_batch.commit.call_count == 1
        assert third_batch.commit.call_count == 1
        assert first_batch.update.call_count == 2
        assert second_batch.update.call_count == 2
        assert third_batch.update.call_count == 1

    def test_queries_the_given_collection(self):
        client = MagicMock()
        client.collection.return_value.stream.return_value = []

        backfill_collection(client, "simulations", "org-123")

        client.collection.assert_called_once_with("simulations")


class TestCollectionsConstant:
    def test_matches_the_collections_firestoredb_writes_to(self):
        """Regression guard: keep in sync with icaro_api.services.db collection names."""
        assert COLLECTIONS == ("rockets", "simulations")


class TestBackfillReport:
    def test_str_format(self):
        report = BackfillReport(collection="rockets", scanned=10, updated=3, already_stamped=7)
        assert str(report) == "rockets: scanned=10 updated=3 already_stamped=7"


class TestParseArgs:
    def test_requires_org_id(self, monkeypatch):
        monkeypatch.delenv("ICARO_BACKFILL_ORG_ID", raising=False)
        with pytest.raises(SystemExit):
            _parse_args(["--project", "proj"])

    def test_requires_project(self, monkeypatch):
        monkeypatch.delenv("ICARO_FIRESTORE_PROJECT", raising=False)
        with pytest.raises(SystemExit):
            _parse_args(["--org-id", "org-123"])

    def test_accepts_explicit_flags(self):
        args = _parse_args(["--org-id", "org-123", "--project", "proj", "--dry-run"])
        assert args.org_id == "org-123"
        assert args.project == "proj"
        assert args.database == "(default)"
        assert args.dry_run is True

    def test_falls_back_to_env_vars(self, monkeypatch):
        monkeypatch.setenv("ICARO_BACKFILL_ORG_ID", "org-from-env")
        monkeypatch.setenv("ICARO_FIRESTORE_PROJECT", "proj-from-env")
        monkeypatch.setenv("ICARO_FIRESTORE_DATABASE", "custom-db")

        args = _parse_args([])

        assert args.org_id == "org-from-env"
        assert args.project == "proj-from-env"
        assert args.database == "custom-db"
        assert args.dry_run is False

    def test_explicit_flags_override_env_vars(self, monkeypatch):
        monkeypatch.setenv("ICARO_BACKFILL_ORG_ID", "org-from-env")
        monkeypatch.setenv("ICARO_FIRESTORE_PROJECT", "proj-from-env")

        args = _parse_args(["--org-id", "org-explicit"])

        assert args.org_id == "org-explicit"
        assert args.project == "proj-from-env"
