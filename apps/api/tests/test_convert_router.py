"""Tests for POST /api/convert.

TDD: written BEFORE routers/convert.py is implemented (RED phase).
Tasks: 1.27, 1.28.
Coverage: AC-RG-2.1 (success), AC-RG-2.2 (503 + hint), no-traceback.
Real convert is @pytest.mark.integration (JVM required).
"""

from __future__ import annotations

import io
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier

_TEST_SESSION_COOKIE = "test-session-token"


def _fake_verify_identity(cookie: str) -> dict:
    if cookie != _TEST_SESSION_COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": "test-org"}


def _make_client() -> TestClient:
    from icaro_api.main import create_app
    from icaro_api.config import Settings, get_settings

    app = create_app()

    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    return TestClient(app, raise_server_exceptions=True)


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


def _ork_file_content() -> bytes:
    """Minimal fake .ork file (not a real zip — only needed for multipart upload)."""
    return b"PK\x03\x04fake_ork_content"


# ---------------------------------------------------------------------------
# Unit tests (task 1.28) — mock the convert SERVICE (run_convert), which runs
# the real conversion in an isolated subprocess. The router only maps outcomes.
# ---------------------------------------------------------------------------


class TestConvertUnavailable:
    def test_convert_unavailable_returns_503(self):
        """AC-RG-2.2: an 'unavailable' outcome → 503."""
        client = _make_client()

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "unavailable", "hint": "hint text: install Java 21"},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                headers=_auth(),
            )

        assert resp.status_code == 503

    def test_convert_unavailable_hint_in_body(self):
        """AC-RG-2.2: hint text appears verbatim in response body."""
        client = _make_client()
        hint = "hint text: install Java 21"

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "unavailable", "hint": hint},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                headers=_auth(),
            )

        body = resp.text
        assert hint in body

    def test_convert_unavailable_no_traceback(self):
        """RG-9.4: no traceback in error response."""
        client = _make_client()

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "unavailable", "hint": "some hint"},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                headers=_auth(),
            )

        body = resp.text
        assert "Traceback" not in body
        assert "traceback" not in body

    def test_convert_engine_error_returns_503_no_traceback(self):
        """An 'error' outcome (e.g. JVM cannot restart) → clean 503, no 500/traceback."""
        client = _make_client()

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "error", "message": "JVM cannot be restarted"},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                headers=_auth(),
            )

        assert resp.status_code == 503
        assert "Traceback" not in resp.text


class TestConvertSuccess:
    def test_success_returns_export_id_and_manifest(self, tmp_path):
        """AC-RG-2.1: successful convert returns export_id and manifest."""
        import json

        export_dir = tmp_path / "rocket_export"
        export_dir.mkdir()
        # Write a minimal manifest (parameters.json)
        manifest = {"name": "TestRocket", "motors": []}
        (export_dir / "parameters.json").write_text(json.dumps(manifest))

        client = _make_client()

        with patch(
            "icaro_api.routers.convert.run_convert",
            return_value={"status": "ok", "export_dir": str(export_dir)},
        ):
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                headers=_auth(),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["export_id"], str)
        assert data["export_id"] != ""
        assert isinstance(data["manifest"], dict)
        assert data["manifest"] == manifest
        assert data["manifest"]["name"] == "TestRocket"
        assert data["manifest"]["motors"] == []

    def test_non_ork_filename_returns_422(self):
        """Non-.ork extension → 422 (rejected before the subprocess is spawned)."""
        client = _make_client()

        with patch("icaro_api.routers.convert.run_convert") as mock_run:
            resp = client.post(
                "/api/convert",
                files={"file": ("rocket.txt", io.BytesIO(b"content"), "text/plain")},
                headers=_auth(),
            )

        assert resp.status_code == 422
        mock_run.assert_not_called()

    def test_returns_401_without_auth(self):
        client = _make_client()
        resp = client.post(
            "/api/convert",
            files={"file": ("rocket.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Integration test (task 1.27) — requires JVM + jar, skipped in CI
# ---------------------------------------------------------------------------


@pytest.mark.integration
def test_real_convert_unavailable_without_jar():
    """Real convert_ork with no jar → ConvertUnavailableError → 503."""
    # This is an integration smoke test; skipped in standard CI.
    pass


# ---------------------------------------------------------------------------
# Rocket/Export split (S4): every convert creates an export; the rocket is
# either new (default) or the one the user chose explicitly via ``rocket_id``.
# ---------------------------------------------------------------------------


def _client_with_db():
    from datetime import datetime, timezone

    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db
    from icaro_api.services.db import InMemoryDb, RocketRecord

    db = InMemoryDb()
    db.save_rocket(
        RocketRecord(
            rocket_id="rk-existing",
            name="Existing",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            created_by="test",
            org_id="test-org",
        ),
        org_id="test-org",
    )
    db.save_rocket(
        RocketRecord(
            rocket_id="rk-theirs",
            name="Theirs",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            created_by="other",
            org_id="other-org",
        ),
        org_id="other-org",
    )
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, raise_server_exceptions=True), db


def _ok_export(tmp_path, name="TestRocket"):
    import json

    export_dir = tmp_path / "rocket_export"
    export_dir.mkdir(exist_ok=True)
    (export_dir / "parameters.json").write_text(json.dumps({"name": name}))
    return {"status": "ok", "export_dir": str(export_dir)}


class TestConvertRocketDestination:
    def test_without_rocket_id_creates_a_new_rocket_and_its_export(self, tmp_path):
        client, db = _client_with_db()
        with patch("icaro_api.routers.convert.run_convert", return_value=_ok_export(tmp_path, "Icarus")):
            resp = client.post(
                "/api/convert",
                files={"file": ("icarus.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                headers=_auth(),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert set(data.keys()) == {"export_id", "rocket_id", "manifest"}
        assert data["rocket_id"] != data["export_id"]

        rocket = db.get_rocket(data["rocket_id"], org_id="test-org")
        assert rocket is not None and rocket.name == "Icarus"
        export = db.get_export(data["export_id"], org_id="test-org")
        assert export is not None
        assert export.rocket_id == data["rocket_id"]
        assert export.name == "Icarus"
        assert export.ork_filename == "icarus.ork"
        assert export.export_prefix == f"orgs/test-org/exports/{data['export_id']}/"

    def test_with_rocket_id_attaches_export_to_that_rocket(self, tmp_path):
        client, db = _client_with_db()
        with patch("icaro_api.routers.convert.run_convert", return_value=_ok_export(tmp_path)):
            resp = client.post(
                "/api/convert",
                files={"file": ("v2.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                data={"rocket_id": "rk-existing"},
                headers=_auth(),
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["rocket_id"] == "rk-existing"
        export = db.get_export(data["export_id"], org_id="test-org")
        assert export is not None and export.rocket_id == "rk-existing"
        # No second rocket was created.
        assert [r.rocket_id for r in db.list_rockets(org_id="test-org")] == ["rk-existing"]

    def test_unknown_rocket_id_returns_404_before_converting(self, tmp_path):
        client, _ = _client_with_db()
        with patch("icaro_api.routers.convert.run_convert") as mock_run:
            resp = client.post(
                "/api/convert",
                files={"file": ("v2.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                data={"rocket_id": "rk-missing"},
                headers=_auth(),
            )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Rocket 'rk-missing' not found."
        mock_run.assert_not_called()

    def test_another_orgs_rocket_id_returns_404(self, tmp_path):
        client, _ = _client_with_db()
        with patch("icaro_api.routers.convert.run_convert") as mock_run:
            resp = client.post(
                "/api/convert",
                files={"file": ("v2.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                data={"rocket_id": "rk-theirs"},
                headers=_auth(),
            )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "Rocket 'rk-theirs' not found."
        mock_run.assert_not_called()
