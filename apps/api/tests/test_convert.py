"""Tests for POST /api/convert with Storage/Db injection.

TDD: T-08 (RED) written first, T-09 (GREEN) wires the router.
Req: REQ-01.1 (export_id is a logical id, not a path)
     REQ-02.1 (artifacts uploaded via storage seam)
     REQ-03.1 (rocket record saved via db seam)
"""

from __future__ import annotations

import io
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import InMemoryDb, RocketRecord
from icaro_api.services.storage import LocalFsStorage

_TEST_SESSION_COOKIE = "test-session-token"


def _fake_verify_identity(cookie: str) -> dict:
    if cookie != _TEST_SESSION_COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": "test-org"}


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


def _ork_bytes() -> bytes:
    return b"PK\x03\x04fake_ork_content"


def _make_client_with_fakes(storage: LocalFsStorage, db: InMemoryDb) -> TestClient:
    """Create TestClient with fake storage and db injected."""
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db, get_storage

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, raise_server_exceptions=True)


class TestConvertExportIdIsLogicalId:
    def test_export_id_does_not_start_with_slash(self, tmp_path):
        """REQ-01.1: export_id must not start with '/'."""
        storage = LocalFsStorage(tmp_path / "blobs")
        db = InMemoryDb()
        client = _make_client_with_fakes(storage, db)

        export_dir = tmp_path / "export"
        export_dir.mkdir()
        (export_dir / "parameters.json").write_text(json.dumps({"name": "TestRocket"}))

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "ok", "export_dir": str(export_dir)},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_bytes()), "application/octet-stream")},
                headers=_auth(),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "export_id" in data
        assert not data["export_id"].startswith("/"), (
            f"export_id must not start with '/': {data['export_id']!r}"
        )

    def test_export_id_does_not_contain_tmp(self, tmp_path):
        """REQ-01.1: export_id must not contain 'tmp'."""
        storage = LocalFsStorage(tmp_path / "blobs")
        db = InMemoryDb()
        client = _make_client_with_fakes(storage, db)

        export_dir = tmp_path / "export"
        export_dir.mkdir()
        (export_dir / "parameters.json").write_text(json.dumps({"name": "TestRocket"}))

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "ok", "export_dir": str(export_dir)},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_bytes()), "application/octet-stream")},
                headers=_auth(),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert "tmp" not in data["export_id"].lower(), (
            f"export_id must not contain 'tmp': {data['export_id']!r}"
        )

    def test_export_id_is_url_safe_slug(self, tmp_path):
        """export_id must be a URL-safe string matching the run_id pattern."""
        import re

        storage = LocalFsStorage(tmp_path / "blobs")
        db = InMemoryDb()
        client = _make_client_with_fakes(storage, db)

        export_dir = tmp_path / "export"
        export_dir.mkdir()
        (export_dir / "parameters.json").write_text(json.dumps({"name": "TestRocket"}))

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "ok", "export_dir": str(export_dir)},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_bytes()), "application/octet-stream")},
                headers=_auth(),
            )

        assert resp.status_code == 200
        export_id = resp.json()["export_id"]
        assert re.match(r'^[A-Za-z0-9_\-]+$', export_id), (
            f"export_id is not URL-safe: {export_id!r}"
        )


class TestConvertStorageAndDbSideEffects:
    def test_storage_upload_dir_called_with_exports_prefix(self, tmp_path):
        """REQ-02.1: convert must upload artifacts via storage seam under exports/."""
        storage = MagicMock(spec=LocalFsStorage)
        db = InMemoryDb()

        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app
        from icaro_api.runs import get_db, get_storage

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings()
        app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
        app.dependency_overrides[get_storage] = lambda: storage
        app.dependency_overrides[get_db] = lambda: db
        client = TestClient(app, raise_server_exceptions=True)

        export_dir = tmp_path / "export"
        export_dir.mkdir()
        (export_dir / "parameters.json").write_text(json.dumps({"name": "MyRocket"}))

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "ok", "export_dir": str(export_dir)},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_bytes()), "application/octet-stream")},
                headers=_auth(),
            )

        assert resp.status_code == 200
        export_id = resp.json()["export_id"]

        # storage.upload_dir must have been called with prefix "exports/{run_id}/"
        storage.upload_dir.assert_called_once()
        call_args = storage.upload_dir.call_args
        prefix = call_args[0][0] if call_args[0] else call_args[1].get("prefix", "")
        assert prefix == f"exports/{export_id}/", (
            f"Expected prefix 'exports/{export_id}/', got: {prefix!r}"
        )

    def test_db_save_rocket_called(self, tmp_path):
        """REQ-03.1: convert must call db.save_rocket with a RocketRecord."""
        storage = LocalFsStorage(tmp_path / "blobs")
        db = MagicMock(spec=InMemoryDb)

        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app
        from icaro_api.runs import get_db, get_storage

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings()
        app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
        app.dependency_overrides[get_storage] = lambda: storage
        app.dependency_overrides[get_db] = lambda: db
        client = TestClient(app, raise_server_exceptions=True)

        export_dir = tmp_path / "export"
        export_dir.mkdir()
        manifest = {"name": "NamedRocket", "motors": []}
        (export_dir / "parameters.json").write_text(json.dumps(manifest))

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "ok", "export_dir": str(export_dir)},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_bytes()), "application/octet-stream")},
                headers=_auth(),
            )

        assert resp.status_code == 200
        db.save_rocket.assert_called_once()
        saved_rec = db.save_rocket.call_args[0][0]
        assert isinstance(saved_rec, RocketRecord)
        assert saved_rec.rocket_id == resp.json()["export_id"]
        assert saved_rec.name == "NamedRocket"
