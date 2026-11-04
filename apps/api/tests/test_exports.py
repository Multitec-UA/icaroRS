"""Tests for GET /api/exports/{export_id} (S4).

An export is one converted ``.ork``. Its detail is the export metadata plus
the manifest, read from object storage (``parameters.json`` under the export
prefix) — never from Firestore, which cannot hold nested arrays.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from icaro_api.services.db import InMemoryDb

from tests.test_rockets import _FakeStorage, _auth, _export, _make_client, _ORG, _OTHER_ORG

_T1 = datetime(2026, 1, 1, tzinfo=timezone.utc)


class TestExportDetail:
    def test_returns_export_with_manifest_from_storage(self):
        db = InMemoryDb()
        manifest = {"name": "Prometheus", "freeform_fins": [{"shape_points": [[0.0, 0.0], [0.1, 0.05]]}]}
        db.save_export(_export("e-detail", "r-1", _T1, name="Prometheus", ork_filename="p.ork"), org_id=_ORG)
        storage = _FakeStorage({"exports/e-detail/parameters.json": json.dumps(manifest).encode()})

        resp = _make_client(db, storage=storage).get("/api/exports/e-detail", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {
            "export_id", "rocket_id", "name", "created_at", "created_by",
            "export_prefix", "gcs_ref", "ork_filename", "has_source_ork", "manifest",
        }
        assert data["export_id"] == "e-detail"
        assert data["rocket_id"] == "r-1"
        assert data["created_at"] == _T1.isoformat()
        assert data["manifest"]["freeform_fins"][0]["shape_points"][1] == [0.1, 0.05]

    def test_manifest_absent_in_storage_degrades_to_empty(self):
        db = InMemoryDb()
        db.save_export(_export("e-nomani", "r-1", _T1), org_id=_ORG)
        resp = _make_client(db).get("/api/exports/e-nomani", headers=_auth())
        assert resp.status_code == 200 and resp.json()["manifest"] == {}

    def test_returns_404_for_unknown_id(self):
        resp = _make_client(InMemoryDb()).get("/api/exports/nope", headers=_auth())
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Export 'nope' not found."

    def test_returns_404_for_another_orgs_export(self):
        db = InMemoryDb()
        db.save_export(_export("e-theirs", "r-1", _T1, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        assert _make_client(db).get("/api/exports/e-theirs", headers=_auth()).status_code == 404

    def test_returns_401_without_auth(self):
        assert _make_client(InMemoryDb()).get("/api/exports/e-1").status_code == 401
