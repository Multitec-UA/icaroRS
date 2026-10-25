"""Unit tests for the rockets → rockets + exports migration script (S3).

Mocks the Firestore client the same way ``test_backfill_org_id.py`` does —
zero live GCP dependency. Emulator-backed round-trip coverage lives in
``test_migrate_rocket_exports_emulator.py``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from icaro_api.scripts.migrate_rocket_exports import (
    MigrationReport,
    _parse_args,
    migrate_rockets,
    migrate_simulations,
    rocket_doc_from_legacy,
)

_T1 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _snap(doc_id: str, data: dict) -> MagicMock:
    snap = MagicMock()
    snap.id = doc_id
    snap.to_dict.return_value = data
    snap.reference = MagicMock(name=f"ref-{doc_id}")
    return snap


def _legacy_rocket(doc_id: str = "r1", **over) -> dict:
    doc = {
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
    doc.update(over)
    return doc


def _client_with(rockets: list[MagicMock] = (), exports_ids: set[str] = frozenset()):
    client = MagicMock()
    collections: dict[str, MagicMock] = {}

    def collection(name):
        col = collections.setdefault(name, MagicMock(name=f"col-{name}"))
        return col

    client.collection.side_effect = collection
    collection("rockets").stream.return_value = list(rockets)
    collection("simulations").stream.return_value = []
    return client, collections


class TestRocketDocFromLegacy:
    def test_keeps_only_group_fields(self):
        new = rocket_doc_from_legacy("r1", _legacy_rocket("r1"))
        assert new == {"rocket_id": "r1", "name": "Icarus", "created_at": _T1, "created_by": "u1", "org_id": "org-1"}


class TestMigrateRockets:
    def test_legacy_doc_becomes_export_plus_rewritten_rocket(self):
        snap = _snap("r1", _legacy_rocket("r1"))
        client, cols = _client_with([snap])
        batch = client.batch.return_value

        report = migrate_rockets(client)

        assert report.scanned == 1 and report.migrated == 1 and report.already_migrated == 0
        # exports/{id} written with the legacy fields plus the two ids.
        cols["exports"].document.assert_called_once_with("r1")
        export_ref = cols["exports"].document.return_value
        batch.set.assert_any_call(
            export_ref,
            {**_legacy_rocket("r1"), "export_id": "r1", "rocket_id": "r1"},
        )
        # rockets/{id} rewritten in place to the new shape (set, not update: the
        # export-only fields must disappear).
        batch.set.assert_any_call(snap.reference, rocket_doc_from_legacy("r1", _legacy_rocket("r1")))
        assert batch.set.call_count == 2
        batch.commit.assert_called_once()

    def test_new_shape_doc_is_skipped(self):
        snap = _snap("r2", {"rocket_id": "r2", "name": "New", "created_at": _T1, "created_by": "u", "org_id": "o"})
        client, cols = _client_with([snap])

        report = migrate_rockets(client)

        assert report.scanned == 1 and report.migrated == 0 and report.already_migrated == 1
        client.batch.return_value.set.assert_not_called()

    def test_rerun_is_idempotent(self):
        """After one run every doc is in the new shape → zero writes."""
        legacy = _snap("r1", _legacy_rocket("r1"))
        client, _ = _client_with([legacy])
        migrate_rockets(client)
        rewritten = _snap("r1", rocket_doc_from_legacy("r1", _legacy_rocket("r1")))
        client2, _ = _client_with([rewritten])

        report = migrate_rockets(client2)

        assert report.migrated == 0 and report.already_migrated == 1
        client2.batch.return_value.set.assert_not_called()

    def test_dry_run_writes_nothing_but_counts(self):
        client, _ = _client_with([_snap("r1", _legacy_rocket("r1"))])

        report = migrate_rockets(client, dry_run=True)

        assert report.migrated == 1
        client.batch.return_value.set.assert_not_called()
        client.batch.return_value.commit.assert_not_called()

    def test_batch_boundary_commits_and_starts_fresh(self, monkeypatch):
        import icaro_api.scripts.migrate_rocket_exports as mod

        monkeypatch.setattr(mod, "_BATCH_LIMIT", 4)  # 2 writes per doc → commit every 2 docs
        snaps = [_snap(f"r{i}", _legacy_rocket(f"r{i}")) for i in range(5)]
        client, _ = _client_with(snaps)
        batches = [MagicMock(name=f"batch{i}") for i in range(4)]
        client.batch.side_effect = batches

        report = migrate_rockets(client)

        assert report.migrated == 5
        # 10 writes: batches of 4, 4, 2 → three commits.
        assert sum(b.commit.call_count for b in batches) == 3
        assert batches[0].set.call_count == 4
        assert batches[2].set.call_count == 2

    def test_missing_rocket_id_field_defaults_to_doc_id(self):
        legacy = _legacy_rocket("r9")
        legacy.pop("rocket_id")
        client, cols = _client_with([_snap("r9", legacy)])
        batch = client.batch.return_value

        migrate_rockets(client)

        export_doc = [c.args[1] for c in batch.set.call_args_list if c.args[0] is cols["exports"].document.return_value][0]
        assert export_doc["export_id"] == "r9" and export_doc["rocket_id"] == "r9"


class TestMigrateSimulations:
    def test_sets_export_id_from_rocket_id_when_missing(self):
        client, cols = _client_with()
        snaps = [
            _snap("s1", {"rocket_id": "r1", "org_id": "o"}),
            _snap("s2", {"rocket_id": "r2", "export_id": "r2", "org_id": "o"}),
            _snap("s3", {"rocket_id": "r3", "export_id": "", "org_id": "o"}),
        ]
        cols["simulations"].stream.return_value = snaps
        batch = client.batch.return_value

        report = migrate_simulations(client)

        assert report.scanned == 3 and report.migrated == 2 and report.already_migrated == 1
        batch.update.assert_any_call(snaps[0].reference, {"export_id": "r1"})
        batch.update.assert_any_call(snaps[2].reference, {"export_id": "r3"})
        assert batch.update.call_count == 2
        batch.commit.assert_called_once()

    def test_dry_run_writes_nothing(self):
        client, cols = _client_with()
        cols["simulations"].stream.return_value = [_snap("s1", {"rocket_id": "r1"})]

        report = migrate_simulations(client, dry_run=True)

        assert report.migrated == 1
        client.batch.return_value.update.assert_not_called()


class TestReportAndArgs:
    def test_report_str(self):
        assert str(MigrationReport("rockets", scanned=3, migrated=2, already_migrated=1)) == (
            "rockets: scanned=3 migrated=2 already_migrated=1"
        )

    def test_requires_project(self, monkeypatch):
        monkeypatch.delenv("ICARO_FIRESTORE_PROJECT", raising=False)
        with pytest.raises(SystemExit):
            _parse_args([])

    def test_accepts_flags_and_env(self, monkeypatch):
        ns = _parse_args(["--project", "p", "--database", "db", "--dry-run"])
        assert (ns.project, ns.database, ns.dry_run) == ("p", "db", True)
        monkeypatch.setenv("ICARO_FIRESTORE_PROJECT", "env-p")
        monkeypatch.setenv("ICARO_FIRESTORE_DATABASE", "env-db")
        ns = _parse_args([])
        assert (ns.project, ns.database, ns.dry_run) == ("env-p", "env-db", False)
