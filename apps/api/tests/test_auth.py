"""Tests for icaro_api.auth — HTTP Basic authentication dependency.

All tests are pure unit tests (no network, no JVM).
TDD: written BEFORE auth.py is implemented (RED phase).

Coverage: AC-RG-8.1 (missing/wrong creds → 401), AC-RG-8.2 (valid creds → 200).
"""

from __future__ import annotations

import base64

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient


def _make_client(user: str = "testuser", password: str = "testpass") -> TestClient:
    """Build a test app wired with require_auth, return its TestClient.

    The stub route GET /ping returns 200 {"ok": True} for authenticated calls.
    """
    # Import here so RED fails fast when auth.py doesn't exist yet.
    from icaro_api.auth import require_auth

    app = FastAPI()

    @app.get("/ping")
    def ping(creds=Depends(require_auth)):  # noqa: ARG001
        return {"ok": True}

    # Override the settings inside auth so tests don't need env vars.
    from icaro_api.config import Settings, get_settings

    def override_settings():
        return Settings(
            basic_user=user,
            basic_pass=password,
            # suppress .env file reads in tests
            _env_file=None,  # type: ignore[call-arg]
        )

    app.dependency_overrides[get_settings] = override_settings
    return TestClient(app, raise_server_exceptions=True)


def _basic_header(user: str, password: str) -> str:
    """Encode credentials as a Basic Authorization header value."""
    token = base64.b64encode(f"{user}:{password}".encode()).decode()
    return f"Basic {token}"


# ---------------------------------------------------------------------------
# AC-RG-8.1 — Missing / wrong credentials → 401
# ---------------------------------------------------------------------------


class TestAuthRejected:
    def test_no_auth_header_returns_401(self):
        client = _make_client()
        resp = client.get("/ping")
        assert resp.status_code == 401

    def test_no_auth_header_includes_www_authenticate(self):
        client = _make_client()
        resp = client.get("/ping")
        assert "WWW-Authenticate" in resp.headers
        assert resp.headers["WWW-Authenticate"].lower().startswith("basic")

    def test_wrong_password_returns_401(self):
        client = _make_client(user="testuser", password="correct")
        resp = client.get(
            "/ping",
            headers={"Authorization": _basic_header("testuser", "wrong")},
        )
        assert resp.status_code == 401

    def test_wrong_username_returns_401(self):
        client = _make_client(user="alice", password="secret")
        resp = client.get(
            "/ping",
            headers={"Authorization": _basic_header("bob", "secret")},
        )
        assert resp.status_code == 401

    def test_empty_credentials_returns_401(self):
        client = _make_client()
        resp = client.get(
            "/ping",
            headers={"Authorization": _basic_header("", "")},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# AC-RG-8.2 — Valid credentials → 200
# ---------------------------------------------------------------------------


class TestAuthAccepted:
    def test_valid_credentials_return_200(self):
        client = _make_client(user="icaro", password="s3cr3t")
        resp = client.get(
            "/ping",
            headers={"Authorization": _basic_header("icaro", "s3cr3t")},
        )
        assert resp.status_code == 200

    def test_valid_credentials_return_expected_body(self):
        client = _make_client(user="icaro", password="s3cr3t")
        resp = client.get(
            "/ping",
            headers={"Authorization": _basic_header("icaro", "s3cr3t")},
        )
        assert resp.json() == {"ok": True}

    def test_auth_with_special_chars_in_password(self):
        """Password containing colon and special chars must work."""
        # A colon in the password is encoded by the client; our decoder
        # splits on the FIRST colon only (RFC 7617 §2).
        # TestClient's basic_auth kwarg handles this correctly.
        from icaro_api.auth import require_auth

        app = FastAPI()

        @app.get("/ping")
        def ping2(creds=Depends(require_auth)):  # noqa: ARG001
            return {"ok": True}

        from icaro_api.config import Settings, get_settings

        def override():
            return Settings(basic_user="admin", basic_pass="p@ss:word!")

        app.dependency_overrides[get_settings] = override
        client = TestClient(app)
        resp = client.get("/ping", auth=("admin", "p@ss:word!"))
        assert resp.status_code == 200
