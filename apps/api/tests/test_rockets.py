"""Tests for GET /api/rockets and GET /api/rockets/{rocket_id} (S4).

A rocket is the group a team uploads ``.ork`` files into; the files are
*exports*. The list returns rocket metadata only; the detail adds the rocket's
exports, newest first. Manifests are served by ``GET /api/exports/{export_id}``
(see ``test_exports.py``).

Req: REQ-04.1 (reverse-chronological list), REQ-04.3 (limit default 20, max 100).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import ExportRecord, InMemoryDb, RocketRecord

_TEST_SESSION_COOKIE = "test-session-token"


def _fake_verify_identity(cookie: str) -> dict:
    if cookie != _TEST_SESSION_COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": "test-org"}


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


class _FakeStorage:
    def __init__(self, blobs: dict[str, bytes] | None = None) -> None:
        self._blobs = blobs or {}

    def open_blob(self, key: str) -> bytes:
        if key not in self._blobs:
            raise KeyError(key)
        return self._blobs[key]

    def upload_dir(self, prefix: str, local_dir: Any) -> None:  # pragma: no cover
        ...

    def download_dir(self, prefix: str, dest: Any) -> None:  # pragma: no cover
        ...

    def exists(self, prefix: str) -> bool:
        return any(k.startswith(prefix) for k in self._blobs)


def _make_client(db: Any, storage: Any = None) -> TestClient:
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db, get_storage

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_storage] = lambda: storage or _FakeStorage()
    return TestClient(app, raise_server_exceptions=True)


_ORG = "test-org"  # matches _fake_verify_identity's org_id claim above
_OTHER_ORG = "other-org"


def _rocket(rocket_id: str, name: str, created_at: datetime, org_id: str = _ORG) -> RocketRecord:
    return RocketRecord(
        rocket_id=rocket_id,
        name=name,
        created_at=created_at,
        created_by="test-user",
        org_id=org_id,
    )


def _export(
    export_id: str,
    rocket_id: str,
    created_at: datetime,
    name: str = "TestRocket",
    org_id: str = _ORG,
    ork_filename: str | None = None,
    has_source_ork: bool = False,
) -> ExportRecord:
    return ExportRecord(
        export_id=export_id,
        rocket_id=rocket_id,
        name=name,
        created_at=created_at,
        created_by="test-user",
        org_id=org_id,
        export_prefix=f"exports/{export_id}/",
        gcs_ref=f"exports/{export_id}/",
        ork_filename=ork_filename,
        has_source_ork=has_source_ork,
    )


_T1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
_T2 = datetime(2026, 2, 1, tzinfo=timezone.utc)
_T3 = datetime(2026, 3, 1, tzinfo=timezone.utc)


class TestRocketsList:
    def test_returns_200(self):
        client = _make_client(InMemoryDb())
        assert client.get("/api/rockets", headers=_auth()).status_code == 200

    def test_returns_reverse_chronological_order(self):
        """REQ-04.1: list must be newest-first."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r1", "Alpha", _T1), org_id=_ORG)
        db.save_rocket(_rocket("r2", "Beta", _T2), org_id=_ORG)
        db.save_rocket(_rocket("r3", "Gamma", _T3), org_id=_ORG)
        resp = _make_client(db).get("/api/rockets", headers=_auth())
        assert resp.status_code == 200
        assert [i["name"] for i in resp.json()] == ["Gamma", "Beta", "Alpha"]

    def test_list_items_have_rocket_fields_only(self):
        """A rocket summary is group metadata: no export/file fields."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r-fields", "TestRocket", _T1), org_id=_ORG)
        db.save_export(_export("e-1", "r-fields", _T1, ork_filename="a.ork"), org_id=_ORG)
        resp = _make_client(db).get("/api/rockets", headers=_auth())
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        item = items[0]
        assert set(item.keys()) == {"rocket_id", "name", "created_at", "created_by"}
        assert item["rocket_id"] == "r-fields"
        assert item["name"] == "TestRocket"
        assert item["created_at"] == _T1.isoformat()
        assert item["created_by"] == "test-user"

    def test_default_limit_is_20(self):
        db = InMemoryDb()
        for i in range(25):
            db.save_rocket(_rocket(f"r-{i}", f"Rocket {i}", datetime(2026, 1, i + 1, tzinfo=timezone.utc)), org_id=_ORG)
        assert len(_make_client(db).get("/api/rockets", headers=_auth()).json()) == 20

    def test_limit_param_is_respected(self):
        db = InMemoryDb()
        for i in range(10):
            db.save_rocket(_rocket(f"r-lim-{i}", f"Rocket {i}", datetime(2026, 1, i + 1, tzinfo=timezone.utc)), org_id=_ORG)
        assert len(_make_client(db).get("/api/rockets?limit=5", headers=_auth()).json()) == 5

    def test_returns_empty_list_when_no_rockets(self):
        resp = _make_client(InMemoryDb()).get("/api/rockets", headers=_auth())
        assert resp.status_code == 200 and resp.json() == []

    def test_returns_401_without_auth(self):
        assert _make_client(InMemoryDb()).get("/api/rockets").status_code == 401

    def test_cursor_pagination_before_param(self):
        from urllib.parse import urlencode

        db = InMemoryDb()
        db.save_rocket(_rocket("r-old", "OldRocket", _T1), org_id=_ORG)
        db.save_rocket(_rocket("r-mid", "MidRocket", _T2), org_id=_ORG)
        db.save_rocket(_rocket("r-new", "NewRocket", _T3), org_id=_ORG)
        resp = _make_client(db).get(f"/api/rockets?{urlencode({'before': _T3.isoformat()})}", headers=_auth())
        names = [i["name"] for i in resp.json()]
        assert "NewRocket" not in names and "MidRocket" in names

    def test_excludes_rockets_owned_by_another_org(self):
        db = InMemoryDb()
        db.save_rocket(_rocket("r-mine", "Mine", _T1), org_id=_ORG)
        db.save_rocket(_rocket("r-theirs", "Theirs", _T2, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        assert [i["name"] for i in _make_client(db).get("/api/rockets", headers=_auth()).json()] == ["Mine"]


class TestRocketDetail:
    def test_detail_lists_exports_newest_first(self):
        """The detail is the rocket plus its exports (files), newest first."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r-detail", "Icarus", _T1), org_id=_ORG)
        db.save_export(_export("e-old", "r-detail", _T1, ork_filename="icarus.ork"), org_id=_ORG)
        db.save_export(_export("e-new", "r-detail", _T2, ork_filename="icarus_v2.ork", has_source_ork=True), org_id=_ORG)
        db.save_export(_export("e-other", "r-other", _T3), org_id=_ORG)
        resp = _make_client(db).get("/api/rockets/r-detail", headers=_auth())
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {"rocket_id", "name", "created_at", "created_by", "exports"}
        assert data["name"] == "Icarus"
        assert [e["export_id"] for e in data["exports"]] == ["e-new", "e-old"]
        newest = data["exports"][0]
        assert set(newest.keys()) == {
            "export_id", "rocket_id", "name", "created_at", "created_by",
            "export_prefix", "gcs_ref", "ork_filename", "has_source_ork",
        }
        assert newest["rocket_id"] == "r-detail"
        assert newest["ork_filename"] == "icarus_v2.ork"
        assert newest["has_source_ork"] is True
        assert newest["export_prefix"] == "exports/e-new/"
        assert "manifest" not in newest

    def test_detail_with_no_exports_returns_empty_list(self):
        db = InMemoryDb()
        db.save_rocket(_rocket("r-empty", "Empty", _T1), org_id=_ORG)
        resp = _make_client(db).get("/api/rockets/r-empty", headers=_auth())
        assert resp.status_code == 200 and resp.json()["exports"] == []

    def test_returns_404_for_unknown_id(self):
        resp = _make_client(InMemoryDb()).get("/api/rockets/does-not-exist", headers=_auth())
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Rocket 'does-not-exist' not found."

    def test_returns_404_for_another_orgs_rocket(self):
        db = InMemoryDb()
        db.save_rocket(_rocket("r-theirs", "Theirs", _T1, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        assert _make_client(db).get("/api/rockets/r-theirs", headers=_auth()).status_code == 404

    def test_detail_never_leaks_another_orgs_exports(self):
        """Even with a matching rocket_id, exports are filtered by the caller's org."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r-shared", "Mine", _T1), org_id=_ORG)
        db.save_export(_export("e-theirs", "r-shared", _T1, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        assert _make_client(db).get("/api/rockets/r-shared", headers=_auth()).json()["exports"] == []

    def test_returns_401_without_auth(self):
        assert _make_client(InMemoryDb()).get("/api/rockets/some-id").status_code == 401
