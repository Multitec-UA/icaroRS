"""Session endpoints — the Identity Platform login boundary.

The browser signs in against Identity Platform directly (Firebase client
SDK) to obtain a short-lived ID token, then exchanges it here for an httpOnly
session cookie. The cookie carries no ``Domain`` attribute, so it stays
scoped to the web origin even though ``/api/*`` is proxied to a separate
Cloud Run service (see apps/web/next.config.ts).

Routes:
  POST /api/auth/session — exchange an ID token for a session cookie.
  POST /api/auth/logout  — clear the session cookie.
  GET  /api/auth/me      — the only way the browser can check "am I signed
                            in?" — the cookie itself is httpOnly and
                            unreadable from JS.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from icaro_api.auth import SESSION_COOKIE_NAME, Identity, require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.services import firebase

router = APIRouter(prefix="/auth", tags=["auth"])


class SessionRequest(BaseModel):
    """Request body for POST /api/auth/session."""

    id_token: str
    """Identity Platform ID token, freshly minted by the client SDK sign-in call."""


class IdentityResponse(BaseModel):
    """Response body for GET /api/auth/me."""

    user_id: str
    org_id: str
    email: str | None = None


@router.post("/session", status_code=status.HTTP_204_NO_CONTENT)
def create_session(
    body: SessionRequest,
    response: Response,
    settings: Settings = Depends(get_settings),
) -> None:
    """Verify the Identity Platform ID token and set the session cookie.

    401 on an invalid/expired ID token, 403 when the account has no
    ``org_id`` claim yet — never a 500 (RG-9.4 pattern).
    """
    try:
        claims = firebase.verify_id_token(body.id_token)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired sign-in token.",
        ) from exc

    if not claims.get("org_id"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is not assigned to an organization.",
        )

    max_age = settings.session_cookie_max_age_days * 24 * 60 * 60
    cookie_value = firebase.create_session_cookie(body.id_token, max_age)

    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=cookie_value,
        max_age=max_age,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        path="/",
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(request: Request, response: Response) -> None:
    """Clear the session cookie. Always succeeds, even on a stale cookie.

    Best-effort revokes the underlying refresh token so a captured cookie
    value cannot keep verifying after logout.
    """
    cookie = request.cookies.get(SESSION_COOKIE_NAME)
    if cookie:
        try:
            claims = firebase.verify_session_cookie(cookie)
            firebase.revoke_refresh_tokens(claims["uid"])
        except Exception:  # noqa: BLE001 — logout must always succeed
            pass
    response.delete_cookie(key=SESSION_COOKIE_NAME, path="/")


@router.get("/me", response_model=IdentityResponse)
def me(identity: Identity = Depends(require_auth)) -> IdentityResponse:
    """Return the caller's identity — lets the browser confirm it's signed in."""
    return IdentityResponse(
        user_id=identity.user_id,
        org_id=identity.org_id,
        email=identity.email,
    )
