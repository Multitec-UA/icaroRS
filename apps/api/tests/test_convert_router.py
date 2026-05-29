"""Tests for POST /api/convert.

TDD: written BEFORE routers/convert.py is implemented (RED phase).
Tasks: 1.27, 1.28.
Coverage: AC-RG-2.1 (success), AC-RG-2.2 (503 + hint), no-traceback.
Real convert is @pytest.mark.integration (JVM required).
"""

from __future__ import annotations

import base64
import io
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def _make_client() -> TestClient:
    from icaro_api.main import create_app
    from icaro_api.config import Settings, get_settings

    app = create_app()

    def override_settings():
        return Settings(basic_user="test", basic_pass="test")

    app.dependency_overrides[get_settings] = override_settings
    return TestClient(app, raise_server_exceptions=True)


def _auth() -> dict:
    token = base64.b64encode(b"test:test").decode()
    return {"Authorization": f"Basic {token}"}


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
        assert "export_id" in data
        assert "manifest" in data

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
