"""Tests for icaro_api.auth — Identity Platform session-cookie authentication.

All tests are pure unit tests (no network, no real Identity Platform
project): ``get_identity_verifier`` is overridden with a fake verifier.

Coverage: missing cookie -> 401, invalid/expired cookie -> 401, cookie with
no org_id claim -> 403, valid cookie -> 200 with the decoded Identity.
"""

from __future__ import annotations

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, Identity, get_identity_verifier, require_auth

_VALID_COOKIE = "valid-session-token"
_VALID_CLAIMS = {"uid": "user-123", "org_id": "org-abc", "email": "pilot@example.com"}


def _fake_verify(cookie: str) -> dict:
    if cookie != _VALID_COOKIE:
        raise ValueError("invalid or expired session cookie")
    return dict(_VALID_CLAIMS)


def _make_client(verifier=_fake_verify) -> TestClient:
    app = FastAPI()

    @app.get("/ping")
    def ping(identity: Identity = Depends(require_auth)):
        return {"user_id": identity.user_id, "org_id": identity.org_id, "email": identity.email}

    app.dependency_overrides[get_identity_verifier] = lambda: verifier
    return TestClient(app, raise_server_exceptions=True)


def _cookie_header(value: str) -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={value}"}


class TestAuthRejected:
    def test_no_cookie_returns_401(self):
        client = _make_client()
        resp = client.get("/ping")
        assert resp.status_code == 401

    def test_wrong_cookie_returns_401(self):
        client = _make_client()
        resp = client.get("/ping", headers=_cookie_header("garbage"))
        assert resp.status_code == 401

    def test_verifier_raising_returns_401(self):
        def raising_verify(cookie: str) -> dict:
            raise RuntimeError("revoked")

        client = _make_client(verifier=raising_verify)
        resp = client.get("/ping", headers=_cookie_header(_VALID_COOKIE))
        assert resp.status_code == 401

    def test_missing_org_id_claim_returns_403(self):
        def verify_no_org(cookie: str) -> dict:
            return {"uid": "user-123"}

        client = _make_client(verifier=verify_no_org)
        resp = client.get("/ping", headers=_cookie_header(_VALID_COOKIE))
        assert resp.status_code == 403


class TestAuthAccepted:
    def test_valid_cookie_returns_200(self):
        client = _make_client()
        resp = client.get("/ping", headers=_cookie_header(_VALID_COOKIE))
        assert resp.status_code == 200

    def test_valid_cookie_returns_decoded_identity(self):
        client = _make_client()
        resp = client.get("/ping", headers=_cookie_header(_VALID_COOKIE))
        assert resp.json() == {
            "user_id": "user-123",
            "org_id": "org-abc",
            "email": "pilot@example.com",
        }

    def test_identity_email_defaults_to_none(self):
        def verify_no_email(cookie: str) -> dict:
            return {"uid": "user-123", "org_id": "org-abc"}

        client = _make_client(verifier=verify_no_email)
        resp = client.get("/ping", headers=_cookie_header(_VALID_COOKIE))
        assert resp.json()["email"] is None


@pytest.mark.parametrize("field", ["uid"])
def test_missing_required_claim_raises(field):
    """A verifier that omits ``uid`` is a contract violation, not a 401/403 case."""

    def verify_missing_field(cookie: str) -> dict:
        claims = dict(_VALID_CLAIMS)
        del claims[field]
        return claims

    client = _make_client(verifier=verify_missing_field)
    with pytest.raises(KeyError):
        client.get("/ping", headers=_cookie_header(_VALID_COOKIE))
