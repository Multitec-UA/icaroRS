"""Thin wrapper over the Firebase Admin SDK for Identity Platform sessions.

``firebase-admin`` is an OPTIONAL dependency gated behind the ``[gcp]`` extra
(mirrors ``google-cloud-firestore`` / ``google-cloud-storage`` — see
pyproject.toml). Every function below imports it lazily so the default
JVM/GCP-free install and the test suite never require it to be present.

Application Default Credentials resolve the GCP project automatically (the
metadata server on Cloud Run, or ``gcloud auth application-default login``
locally) — no explicit project id is configured here.
"""

from __future__ import annotations

_app = None


def _ensure_app():
    """Lazily initialize the (process-wide) Firebase Admin app."""
    global _app
    if _app is None:
        import firebase_admin

        _app = firebase_admin.initialize_app()
    return _app


def verify_id_token(id_token: str) -> dict:
    """Verify a freshly-minted Identity Platform ID token, return its claims."""
    from firebase_admin import auth as firebase_auth

    _ensure_app()
    return firebase_auth.verify_id_token(id_token, check_revoked=True)


def create_session_cookie(id_token: str, max_age_seconds: int) -> str:
    """Exchange a verified ID token for a long-lived session cookie value."""
    from firebase_admin import auth as firebase_auth

    _ensure_app()
    return firebase_auth.create_session_cookie(id_token, expires_in=max_age_seconds)


def verify_session_cookie(session_cookie: str) -> dict:
    """Verify a session cookie (checking revocation), return its claims."""
    from firebase_admin import auth as firebase_auth

    _ensure_app()
    return firebase_auth.verify_session_cookie(session_cookie, check_revoked=True)


def revoke_refresh_tokens(uid: str) -> None:
    """Best-effort revoke so the session cookie stops verifying after logout."""
    from firebase_admin import auth as firebase_auth

    _ensure_app()
    firebase_auth.revoke_refresh_tokens(uid)
