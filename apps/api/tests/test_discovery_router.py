"""Tests for GET /api/atmosphere/suggest and GET /api/elevation.

TDD: written BEFORE routers/discovery.py is implemented (RED phase).
Tasks: 1.22, 1.23.
Coverage: AC-RG-2.7, AC-RG-2.8, AC-RG-2.9.
"""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

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


@pytest.fixture
def client():
    return _make_client()


# ---------------------------------------------------------------------------
# GET /api/atmosphere/suggest
# ---------------------------------------------------------------------------


class TestAtmosphereSuggest:
    def _date_in_window(self) -> str:
        """ISO date 5 days from now — within the 16-day GFS window."""
        dt = datetime.now(timezone.utc) + timedelta(days=5)
        return dt.isoformat()

    def _date_out_window(self) -> str:
        """ISO date 30 days from now — outside the GFS window."""
        dt = datetime.now(timezone.utc) + timedelta(days=30)
        return dt.isoformat()

    def test_in_window_returns_forecast(self, client):
        """AC-RG-2.7: date within window → model=forecast, within_gfs_window=true."""
        resp = client.get(
            "/api/atmosphere/suggest",
            params={"date": self._date_in_window()},
            headers=_auth(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["model"] == "forecast"
        assert data["within_gfs_window"] is True
        assert data["reason"]  # non-empty human-readable string

    def test_out_of_window_returns_standard_atmosphere(self, client):
        """AC-RG-2.8: date out of window → model=standard_atmosphere, within_gfs_window=false."""
        resp = client.get(
            "/api/atmosphere/suggest",
            params={"date": self._date_out_window()},
            headers=_auth(),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["model"] == "standard_atmosphere"
        assert data["within_gfs_window"] is False

    def test_reason_is_non_empty_string(self, client):
        """AC-RG-2.7: reason is a plain-language non-empty string."""
        resp = client.get(
            "/api/atmosphere/suggest",
            params={"date": self._date_in_window()},
            headers=_auth(),
        )
        data = resp.json()
        assert isinstance(data["reason"], str)
        assert len(data["reason"]) > 5

    def test_missing_date_returns_422(self, client):
        """date param is required."""
        resp = client.get("/api/atmosphere/suggest", headers=_auth())
        assert resp.status_code == 422

    def test_returns_401_without_auth(self, client):
        resp = client.get(
            "/api/atmosphere/suggest",
            params={"date": self._date_in_window()},
        )
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/elevation
# ---------------------------------------------------------------------------


class TestElevationEndpoint:
    def test_success_returns_elevation(self, client):
        """Successful elevation lookup returns elevation_m and source."""
        from icaro_api.services.elevation import ElevationResult

        mock_result = ElevationResult(elevation=432.0, source="dem")
        with patch(
            "icaro_api.routers.discovery.lookup_elevation",
            new=AsyncMock(return_value=mock_result),
        ):
            resp = client.get(
                "/api/elevation", params={"lat": 48.8566, "lon": 2.3522}, headers=_auth()
            )
        assert resp.status_code == 200
        data = resp.json()
        assert data["elevation"] == pytest.approx(432.0)
        assert data["source"] == "dem"

    def test_unavailable_returns_503(self, client):
        """AC-RG-2.9: elevation service unavailable → 503."""
        from icaro_api.services.elevation import ElevationResult

        mock_result = ElevationResult(elevation=None, source="unavailable")
        with patch(
            "icaro_api.routers.discovery.lookup_elevation",
            new=AsyncMock(return_value=mock_result),
        ):
            resp = client.get(
                "/api/elevation", params={"lat": 48.8566, "lon": 2.3522}, headers=_auth()
            )
        assert resp.status_code == 503

    def test_no_traceback_in_503(self, client):
        """RG-9.4: no traceback in error response."""
        from icaro_api.services.elevation import ElevationResult

        mock_result = ElevationResult(elevation=None, source="unavailable")
        with patch(
            "icaro_api.routers.discovery.lookup_elevation",
            new=AsyncMock(return_value=mock_result),
        ):
            resp = client.get(
                "/api/elevation", params={"lat": 48.8566, "lon": 2.3522}, headers=_auth()
            )
        body = resp.text
        assert "Traceback" not in body
        assert "traceback" not in body

    def test_missing_lat_returns_422(self, client):
        resp = client.get("/api/elevation", params={"lon": 2.3522}, headers=_auth())
        assert resp.status_code == 422

    def test_returns_401_without_auth(self, client):
        resp = client.get("/api/elevation", params={"lat": 48.8566, "lon": 2.3522})
        assert resp.status_code == 401
