"""FirestoreDb contract for the ``exports`` collection and the new ``rockets`` shape (S1).

Mocks ``google.cloud.firestore.Client`` like ``test_services_firestore_db.py``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from icaro_api.services.db import ExportRecord, FirestoreDb, RocketRecord, SimRecord

_ORG = "org-ci"
_OTHER_ORG = "org-other"
_T1 = datetime(2026, 1, 1, tzinfo=timezone.utc)


def _export(export_id: str = "e1", rocket_id: str = "rk1", org_id: str = _ORG) -> ExportRecord:
    return ExportRecord(
        export_id=export_id,
        rocket_id=rocket_id,
        name="TestRocket",
        created_at=_T1,
        created_by="ci",
        org_id=org_id,
        export_prefix=f"orgs/{org_id}/exports/{export_id}/",
        manifest={"name": "TestRocket", "freeform_fins": [{"shape_points": [[0.0, 0.0], [0.1, 0.2]]}]},
        gcs_ref=f"orgs/{org_id}/exports/{export_id}/",
        ork_filename="test.ork",
        has_source_ork=True,
    )


@pytest.fixture()
def client():
    return MagicMock()


@pytest.fixture()
def fs(client):
    db = FirestoreDb.__new__(FirestoreDb)
    db._db = client
    return db


def _chained_query(client):
    q = client.collection.return_value
    q.where.return_value = q
    q.order_by.return_value = q
    q.limit.return_value = q
    q.start_after.return_value = q
    return q


def _snap(doc_id: str, data: dict, exists: bool = True) -> MagicMock:
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = exists
    snap.to_dict.return_value = data
    return snap


class TestSaveExport:
    def test_writes_to_exports_collection_without_manifest(self, fs, client):
        fs.save_export(_export("e-save"), org_id=_ORG)
        client.collection.assert_called_once_with("exports")
        client.collection.return_value.document.assert_called_once_with("e-save")
        doc = client.collection.return_value.document.return_value.set.call_args[0][0]
        assert "manifest" not in doc
        assert doc["rocket_id"] == "rk1"
        assert doc["export_prefix"] == f"orgs/{_ORG}/exports/e-save/"
        assert doc["ork_filename"] == "test.ork"
        assert doc["has_source_ork"] is True
        assert isinstance(doc["created_at"], datetime)

    def test_rejects_mismatched_org_id(self, fs, client):
        with pytest.raises(ValueError):
            fs.save_export(_export("e-bad", org_id=_ORG), org_id=_OTHER_ORG)
        client.collection.assert_not_called()


class TestSaveRocketNewShape:
    def test_rocket_doc_holds_group_metadata_only(self, fs, client):
        rec = RocketRecord(rocket_id="rk-save", name="Icarus", created_at=_T1, created_by="ci", org_id=_ORG)
        fs.save_rocket(rec, org_id=_ORG)
        client.collection.assert_called_once_with("rockets")
        doc = client.collection.return_value.document.return_value.set.call_args[0][0]
        assert set(doc) == {"rocket_id", "name", "created_at", "created_by", "org_id"}


class TestGetExport:
    def test_returns_export_record(self, fs, client):
        client.collection.return_value.document.return_value.get.return_value = _snap(
            "e-get",
            {
                "rocket_id": "rk9",
                "name": "Icarus",
                "created_at": _T1,
                "created_by": "ci",
                "org_id": _ORG,
                "export_prefix": "orgs/org-ci/exports/e-get/",
                "gcs_ref": "orgs/org-ci/exports/e-get/",
                "ork_filename": "icarus.ork",
                "has_source_ork": True,
            },
        )
        got = fs.get_export("e-get", org_id=_ORG)
        client.collection.assert_called_once_with("exports")
        assert got is not None
        assert got.export_id == "e-get"
        assert got.rocket_id == "rk9"
        assert got.manifest == {}
        assert got.ork_filename == "icarus.ork"

    def test_returns_none_when_missing_or_other_org(self, fs, client):
        client.collection.return_value.document.return_value.get.return_value = _snap("x", {}, exists=False)
        assert fs.get_export("x", org_id=_ORG) is None
        client.collection.return_value.document.return_value.get.return_value = _snap(
            "y", {"org_id": _OTHER_ORG, "rocket_id": "rk"}
        )
        assert fs.get_export("y", org_id=_ORG) is None


class TestListExports:
    def test_filters_by_org_and_orders_desc(self, fs, client):
        q = _chained_query(client)
        q.stream.return_value = []
        fs.list_exports(org_id=_ORG, limit=10)
        client.collection.assert_called_with("exports")
        q.where.assert_called_once_with("org_id", "==", _ORG)
        assert q.order_by.call_args.args[0] == "created_at"
        assert q.order_by.call_args.kwargs["direction"] == "DESCENDING"
        q.limit.assert_called_once_with(10)
        q.start_after.assert_not_called()

    def test_adds_rocket_filter_when_given(self, fs, client):
        q = _chained_query(client)
        q.stream.return_value = []
        fs.list_exports(org_id=_ORG, rocket_id="rk-a")
        q.where.assert_any_call("org_id", "==", _ORG)
        q.where.assert_any_call("rocket_id", "==", "rk-a")
        assert q.where.call_count == 2

    def test_cursor_and_deserialisation(self, fs, client):
        q = _chained_query(client)
        q.stream.return_value = [
            _snap("e-listed", {"rocket_id": "rk1", "name": "L", "created_at": _T1, "created_by": "ci", "org_id": _ORG, "export_prefix": "p/", "gcs_ref": "p/", "ork_filename": None, "has_source_ork": False})
        ]
        before = _T1 + timedelta(days=1)
        res = fs.list_exports(org_id=_ORG, before=before)
        q.start_after.assert_called_once_with({"created_at": before})
        assert len(res) == 1 and res[0].export_id == "e-listed" and res[0].rocket_id == "rk1"


class TestSimulationsExportId:
    def test_save_simulation_persists_export_id(self, fs, client):
        sim = SimRecord(simulation_id="s1", rocket_id="rk1", export_id="e1", scenario={}, created_at=_T1, created_by="ci", org_id=_ORG, status="done")
        fs.save_simulation(sim, org_id=_ORG)
        doc = client.collection.return_value.document.return_value.set.call_args[0][0]
        assert doc["export_id"] == "e1" and doc["rocket_id"] == "rk1"

    def test_get_simulation_reads_export_id(self, fs, client):
        client.collection.return_value.document.return_value.get.return_value = _snap(
            "s1", {"rocket_id": "rk1", "export_id": "e1", "org_id": _ORG, "created_at": _T1, "status": "done"}
        )
        got = fs.get_simulation("s1", org_id=_ORG)
        assert got is not None and got.export_id == "e1"

    def test_list_simulations_rocket_filter(self, fs, client):
        q = _chained_query(client)
        q.stream.return_value = []
        fs.list_simulations(org_id=_ORG, rocket_id="rk-a")
        q.where.assert_any_call("org_id", "==", _ORG)
        q.where.assert_any_call("rocket_id", "==", "rk-a")
