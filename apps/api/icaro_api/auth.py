"""HTTP Basic authentication dependency for icaroRS API.

A single shared credential pair protects all ``/api/*`` routes (RG-8.1–8.4).
Credentials are loaded from env vars via the ``Settings`` object — never
hardcoded (RG-8.2).

Timing-safe comparison (``secrets.compare_digest``) prevents timing attacks
on the credential check.

This is documented as MVP-only — not for public deployment (RG-8.5).

Usage
-----
Apply to a router at declaration time::

    router = APIRouter(dependencies=[Depends(require_auth)])

Or to a single endpoint::

    @app.get("/ping")
    def ping(creds=Depends(require_auth)):
        ...
"""

from __future__ import annotations

import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from icaro_api.config import Settings, get_settings

_security = HTTPBasic()


def require_auth(
    credentials: HTTPBasicCredentials = Depends(_security),
    settings: Settings = Depends(get_settings),
) -> HTTPBasicCredentials:
    """FastAPI dependency that enforces HTTP Basic auth.

    Compares the submitted username and password against ``Settings.basic_user``
    and ``Settings.basic_pass`` using :func:`secrets.compare_digest` to prevent
    timing attacks.

    Parameters
    ----------
    credentials : HTTPBasicCredentials
        Parsed from the ``Authorization`` header by FastAPI's HTTPBasic security
        scheme.  Absent header → FastAPI raises 401 automatically before this
        dependency body runs.
    settings : Settings
        Application settings injected via ``get_settings``.

    Returns
    -------
    HTTPBasicCredentials
        The validated credentials (useful for logging if needed).

    Raises
    ------
    HTTPException
        401 with ``WWW-Authenticate: Basic`` on credential mismatch.
    """
    correct_user = settings.basic_user
    correct_pass = settings.basic_pass

    # Use constant-time comparison for both fields to prevent oracle attacks.
    # encode() keeps bytes comparison safe regardless of string content.
    user_ok = secrets.compare_digest(
        credentials.username.encode("utf-8"),
        correct_user.encode("utf-8"),
    )
    pass_ok = secrets.compare_digest(
        credentials.password.encode("utf-8"),
        correct_pass.encode("utf-8"),
    )

    if not (user_ok and pass_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials.",
            headers={"WWW-Authenticate": "Basic"},
        )

    return credentials
