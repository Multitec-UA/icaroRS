"""Tests for GET /api/rockets and GET /api/rockets/{rocket_id} — T-18, T-20.

TDD: T-18 and T-20 (RED) written first; T-19/T-21 (GREEN) wires rockets.py.
Req: REQ-04.1 (reverse-chronological list)
     REQ-04.2 (list fields: rocket_id, name, created_at, created_by)
     REQ-04.3 (limit default 20, max 100)
     REQ-04.4 (detail endpoint includes manifest + gcs_ref)
"""

from __future__ import annotations

import json
from datetime import datetime, timezone, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import InMemoryDb, RocketRecord

_TEST_SESSION_COOKIE = "test-session-token"


def _fake_verify_identity(cookie: str) -> dict:
    if cookie != _TEST_SESSION_COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": "test-org"}


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


class _FakeStorage:
    """Minimal in-memory Storage stub.

    The detail endpoint loads the manifest via ``open_blob`` from object
    storage (``parameters.json``), so the storage seam must be overridden in
    tests that exercise the manifest. Other Storage methods are unused here.
    """

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


def _rocket(
    rocket_id: str,
    name: str,
    created_at: datetime,
    manifest: dict | None = None,
    gcs_ref: str = "",
    org_id: str = _ORG,
    ork_filename: str | None = None,
    has_source_ork: bool = False,
) -> RocketRecord:
    return RocketRecord(
        rocket_id=rocket_id,
        name=name,
        created_at=created_at,
        created_by="test-user",
        org_id=org_id,
        export_prefix=f"exports/{rocket_id}/",
        manifest=manifest or {"name": name},
        gcs_ref=gcs_ref or f"exports/{rocket_id}/",
        ork_filename=ork_filename,
        has_source_ork=has_source_ork,
    )


_T1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
_T2 = datetime(2026, 2, 1, tzinfo=timezone.utc)
_T3 = datetime(2026, 3, 1, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# T-18 — GET /api/rockets list
# ---------------------------------------------------------------------------


class TestRocketsList:
    def test_returns_200(self):
        """GET /api/rockets returns 200 OK."""
        db = InMemoryDb()
        client = _make_client(db)
        resp = client.get("/api/rockets", headers=_auth())
        assert resp.status_code == 200

    def test_returns_reverse_chronological_order(self):
        """REQ-04.1: list must be newest-first."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r1", "Alpha", _T1), org_id=_ORG)
        db.save_rocket(_rocket("r2", "Beta", _T2), org_id=_ORG)
        db.save_rocket(_rocket("r3", "Gamma", _T3), org_id=_ORG)
        client = _make_client(db)

        resp = client.get("/api/rockets", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        names = [item["name"] for item in items]
        assert names == ["Gamma", "Beta", "Alpha"], (
            f"Expected reverse-chrono order [Gamma, Beta, Alpha], got {names}"
        )

    def test_list_items_have_required_fields(self):
        """REQ-04.2: each item must include rocket_id, name, created_at, created_by.

        Also asserts the drift fields called out in issue #70 — export_prefix,
        gcs_ref, ork_filename, has_source_ork — survive response_model with
        their correct values and types (a regression test for silent field
        drops / type coercion, e.g. gcs_ref becoming None instead of "").
        """
        db = InMemoryDb()
        db.save_rocket(
            _rocket(
                "r-fields",
                "TestRocket",
                _T1,
                gcs_ref="exports/r-fields/",
                ork_filename="rocket.ork",
                has_source_ork=True,
            ),
            org_id=_ORG,
        )
        client = _make_client(db)

        resp = client.get("/api/rockets", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        item = items[0]
        assert set(item.keys()) == {
            "rocket_id",
            "name",
            "created_at",
            "created_by",
            "export_prefix",
            "gcs_ref",
            "ork_filename",
            "has_source_ork",
        }, f"Unexpected field set in list item: {sorted(item.keys())}"
        assert item["rocket_id"] == "r-fields"
        assert item["name"] == "TestRocket"
        assert item["created_at"] == _T1.isoformat()
        assert item["created_by"] == "test-user"
        assert item["export_prefix"] == "exports/r-fields/"
        assert item["gcs_ref"] == "exports/r-fields/"
        assert item["ork_filename"] == "rocket.ork"
        assert item["has_source_ork"] is True

    def test_list_item_defaults_gcs_ref_and_ork_fields(self):
        """A rocket saved without an explicit ork/gcs_ref must still round-trip
        the declared defaults (empty-string gcs_ref, null ork_filename, False
        has_source_ork) rather than silently dropping or coercing them."""
        db = InMemoryDb()
        db.save_rocket(
            _rocket("r-defaults", "DefaultsRocket", _T1, gcs_ref="exports/r-defaults/"),
            org_id=_ORG,
        )
        client = _make_client(db)

        resp = client.get("/api/rockets", headers=_auth())

        assert resp.status_code == 200
        item = resp.json()[0]
        assert item["ork_filename"] is None
        assert item["has_source_ork"] is False
        assert isinstance(item["gcs_ref"], str)

    def test_default_limit_is_20(self):
        """REQ-04.3: default limit must be 20."""
        db = InMemoryDb()
        for i in range(25):
            dt = datetime(2026, 1, i + 1, tzinfo=timezone.utc)
            db.save_rocket(_rocket(f"r-{i}", f"Rocket {i}", dt), org_id=_ORG)
        client = _make_client(db)

        resp = client.get("/api/rockets", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 20, (
            f"Default limit must be 20; got {len(items)}"
        )

    def test_limit_param_is_respected(self):
        """REQ-04.3: ?limit=5 must return at most 5 items."""
        db = InMemoryDb()
        for i in range(10):
            dt = datetime(2026, 1, i + 1, tzinfo=timezone.utc)
            db.save_rocket(_rocket(f"r-lim-{i}", f"Rocket {i}", dt), org_id=_ORG)
        client = _make_client(db)

        resp = client.get("/api/rockets?limit=5", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 5

    def test_returns_empty_list_when_no_rockets(self):
        """Empty db → empty list, not 404."""
        db = InMemoryDb()
        client = _make_client(db)
        resp = client.get("/api/rockets", headers=_auth())
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_401_without_auth(self):
        db = InMemoryDb()
        client = _make_client(db)
        resp = client.get("/api/rockets")
        assert resp.status_code == 401

    def test_cursor_pagination_before_param(self):
        """REQ-04.3: ?before= cursor returns only older items."""
        from urllib.parse import urlencode

        db = InMemoryDb()
        db.save_rocket(_rocket("r-old", "OldRocket", _T1), org_id=_ORG)
        db.save_rocket(_rocket("r-mid", "MidRocket", _T2), org_id=_ORG)
        db.save_rocket(_rocket("r-new", "NewRocket", _T3), org_id=_ORG)
        client = _make_client(db)

        # URL-encode the ISO timestamp so that '+' (in '+00:00') is safe
        before_str = _T3.isoformat()
        qs = urlencode({"before": before_str})
        resp = client.get(f"/api/rockets?{qs}", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        names = [item["name"] for item in items]
        assert "NewRocket" not in names, (
            f"'before' cursor failed: NewRocket (T3) should be excluded; got {names}"
        )
        assert "MidRocket" in names or "OldRocket" in names

    def test_excludes_rockets_owned_by_another_org(self):
        """Issue #43: a rocket owned by another organization must never appear."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r-mine", "Mine", _T1, org_id=_ORG), org_id=_ORG)
        db.save_rocket(_rocket("r-theirs", "Theirs", _T2, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        client = _make_client(db)

        resp = client.get("/api/rockets", headers=_auth())

        assert resp.status_code == 200
        names = [item["name"] for item in resp.json()]
        assert names == ["Mine"], f"Cross-org rocket leaked into the list: {names}"


# ---------------------------------------------------------------------------
# T-20 — GET /api/rockets/{rocket_id} detail
# ---------------------------------------------------------------------------


class TestRocketDetail:
    def test_returns_full_record_including_manifest(self):
        """REQ-04.4: detail endpoint must include manifest and gcs_ref.

        The manifest is served from object storage (``parameters.json`` under
        the export prefix), not Firestore — see ``FirestoreDb.save_rocket``.
        """
        db = InMemoryDb()
        manifest = {"name": "Prometheus", "mass": 12.5, "diameter": 0.08}
        db.save_rocket(_rocket("r-detail", "Prometheus", _T1, manifest=manifest, gcs_ref="exports/r-detail/"), org_id=_ORG)
        storage = _FakeStorage(
            {"exports/r-detail/parameters.json": json.dumps(manifest).encode()}
        )
        client = _make_client(db, storage=storage)

        resp = client.get("/api/rockets/r-detail", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        assert "manifest" in data, f"Missing manifest in detail response: {data.keys()}"
        assert "gcs_ref" in data, f"Missing gcs_ref in detail response: {data.keys()}"
        assert data["manifest"]["name"] == "Prometheus"

    def test_manifest_with_nested_arrays_served_from_storage(self):
        """Regression for the 500: freeform-fin manifests (arrays nested in
        arrays) are stored in object storage and load fine via the endpoint,
        even though Firestore could never have held them."""
        db = InMemoryDb()
        manifest = {
            "name": "Freeform",
            "freeform_fins": [
                {"shape_points": [[0.0, 0.0], [0.1, 0.05], [0.2, 0.0]]}
            ],
        }
        db.save_rocket(_rocket("r-ff", "Freeform", _T1), org_id=_ORG)
        storage = _FakeStorage(
            {"exports/r-ff/parameters.json": json.dumps(manifest).encode()}
        )
        client = _make_client(db, storage=storage)

        resp = client.get("/api/rockets/r-ff", headers=_auth())

        assert resp.status_code == 200
        assert resp.json()["manifest"]["freeform_fins"][0]["shape_points"][1] == [0.1, 0.05]

    def test_manifest_absent_in_storage_degrades_to_empty(self):
        """If parameters.json is missing, the detail endpoint serves manifest={}
        rather than 500ing."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r-nomani", "NoManifest", _T1), org_id=_ORG)
        client = _make_client(db)  # default empty storage

        resp = client.get("/api/rockets/r-nomani", headers=_auth())

        assert resp.status_code == 200
        assert resp.json()["manifest"] == {}

    def test_returns_all_required_fields(self):
        """REQ-04.4: detail must include rocket_id, name, created_at, created_by, manifest, gcs_ref.

        Also asserts the drift fields called out in issue #70 — export_prefix,
        gcs_ref, ork_filename, has_source_ork — survive response_model with
        their correct values and types (a regression test for silent field
        drops / type coercion, e.g. gcs_ref becoming None instead of "").
        """
        db = InMemoryDb()
        db.save_rocket(
            _rocket(
                "r-fields2",
                "FieldsRocket",
                _T2,
                gcs_ref="exports/r-fields2/",
                ork_filename="fields.ork",
                has_source_ork=True,
            ),
            org_id=_ORG,
        )
        client = _make_client(db)

        resp = client.get("/api/rockets/r-fields2", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {
            "rocket_id",
            "name",
            "created_at",
            "created_by",
            "export_prefix",
            "gcs_ref",
            "ork_filename",
            "has_source_ork",
            "manifest",
        }, f"Unexpected field set in detail response: {sorted(data.keys())}"
        assert data["rocket_id"] == "r-fields2"
        assert data["name"] == "FieldsRocket"
        assert data["created_at"] == _T2.isoformat()
        assert data["created_by"] == "test-user"
        assert data["export_prefix"] == "exports/r-fields2/"
        assert data["gcs_ref"] == "exports/r-fields2/"
        assert data["ork_filename"] == "fields.ork"
        assert data["has_source_ork"] is True
        assert isinstance(data["manifest"], dict)

    def test_detail_defaults_gcs_ref_and_ork_fields(self):
        """A rocket saved without an explicit ork/gcs_ref must still round-trip
        the declared defaults (empty-string gcs_ref, null ork_filename, False
        has_source_ork) rather than silently dropping or coercing them."""
        db = InMemoryDb()
        db.save_rocket(
            _rocket("r-defaults2", "DefaultsRocket2", _T1, gcs_ref="exports/r-defaults2/"),
            org_id=_ORG,
        )
        client = _make_client(db)

        resp = client.get("/api/rockets/r-defaults2", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        assert data["ork_filename"] is None
        assert data["has_source_ork"] is False
        assert isinstance(data["gcs_ref"], str)

    def test_returns_404_for_unknown_id(self):
        """REQ-04.4: unknown rocket_id → 404."""
        db = InMemoryDb()
        client = _make_client(db)
        resp = client.get("/api/rockets/does-not-exist", headers=_auth())
        assert resp.status_code == 404

    def test_returns_404_for_another_orgs_rocket(self):
        """Issue #43: a rocket owned by another organization must 404, not 200.

        This is the ownership-enforcement case — the id is valid and the
        record exists, it just isn't the caller's.
        """
        db = InMemoryDb()
        db.save_rocket(_rocket("r-theirs", "Theirs", _T1, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        client = _make_client(db)
        resp = client.get("/api/rockets/r-theirs", headers=_auth())
        assert resp.status_code == 404

    def test_returns_401_without_auth(self):
        db = InMemoryDb()
        client = _make_client(db)
        resp = client.get("/api/rockets/some-id")
        assert resp.status_code == 401
