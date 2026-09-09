"""Session-cookie authentication dependency for icaroRS API.

Callers authenticate through GCP Identity Platform (Firebase Auth); this
module verifies the resulting httpOnly session cookie (RG-8.1-8.4) and
resolves it to an :class:`Identity` — the caller's user id plus the
organization id carried as a custom claim on the token, the tenancy boundary
for the rest of M1.

Verification is delegated to an injectable ``get_identity_verifier``
dependency (see ``icaro_api.services.firebase`` for the real Identity
Platform-backed implementation) so tests can supply a fake verifier instead
of standing up a real Identity Platform project.

Usage
-----
Apply to a router at declaration time::

    router = APIRouter(dependencies=[Depends(require_auth)])

Or wherever the identity itself is needed (e.g. to stamp ``created_by``)::

    @app.post("/thing")
    def create_thing(identity: Identity = Depends(require_auth)):
        ...
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, HTTPException, Request, status

from icaro_api.services import firebase

SESSION_COOKIE_NAME = "icaro_session"

IdentityVerifier = Callable[[str], dict]


@dataclass(frozen=True)
class Identity:
    """Authenticated caller, decoded from a verified session cookie.

    ``org_id`` is the tenancy boundary — persisted verbatim wherever
    ``created_by``/ownership is recorded (this is part of the domain
    contract: callers must not synthesize an ``Identity`` themselves).
    """

    user_id: str
    org_id: str
    email: str | None = None


def get_identity_verifier() -> IdentityVerifier:
    """Return the callable that turns a raw session cookie into claims.

    Isolated behind a dependency so tests can override it
    (``app.dependency_overrides[get_identity_verifier]``) instead of
    requiring a real Identity Platform project.
    """
    return firebase.verify_session_cookie


def require_auth(
    request: Request,
    verify: IdentityVerifier = Depends(get_identity_verifier),
) -> Identity:
    """FastAPI dependency that verifies the Identity Platform session cookie.

    Raises
    ------
    HTTPException
        401 when the cookie is missing, invalid, expired, or revoked.
        403 when the token carries no ``org_id`` claim (account not yet
        assigned to an organization).
    """
    cookie = request.cookies.get(SESSION_COOKIE_NAME)
    if not cookie:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing session cookie.",
        )

    try:
        claims = verify(cookie)
    except Exception as exc:  # noqa: BLE001 — any verification failure is 401
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session.",
        ) from exc

    org_id = claims.get("org_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not assigned to an organization.",
        )

    return Identity(
        user_id=claims["uid"],
        org_id=org_id,
        email=claims.get("email"),
    )
