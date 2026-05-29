"""Tests for icaro_api.services.elevation — async DEM lookup service.

TDD: written BEFORE services/elevation.py is implemented (RED phase).
Tasks: 1.24, 1.25, 1.26.
Coverage: success path, timeout path, real open-elevation (integration).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import httpx


# ---------------------------------------------------------------------------
# Unit tests (task 1.24)
# ---------------------------------------------------------------------------


class TestLookupElevationSuccess:
    @pytest.mark.asyncio
    async def test_success_returns_elevation_and_source(self):
        """Successful HTTP response returns ElevationResult with float elevation."""
        from icaro_api.services.elevation import lookup_elevation
        from icaro_api.config import Settings

        settings = Settings(elevation_url="https://fake.elevation.test/api/v1/lookup")

        mock_response = MagicMock()
        mock_response.raise_for_status.return_value = None
        mock_response.json.return_value = {
            "results": [{"latitude": 48.8566, "longitude": 2.3522, "elevation": 432.1}]
        }

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("icaro_api.services.elevation.httpx.AsyncClient", return_value=mock_client):
            result = await lookup_elevation(48.8566, 2.3522, settings)

        assert result.elevation == pytest.approx(432.1)
        assert result.source == "dem"

    @pytest.mark.asyncio
    async def test_timeout_returns_unavailable(self):
        """Timeout → fallback ElevationResult(elevation=None, source='unavailable')."""
        from icaro_api.services.elevation import lookup_elevation
        from icaro_api.config import Settings

        settings = Settings(elevation_url="https://fake.elevation.test/api/v1/lookup")

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))

        with patch("icaro_api.services.elevation.httpx.AsyncClient", return_value=mock_client):
            result = await lookup_elevation(48.8566, 2.3522, settings)

        assert result.elevation is None
        assert result.source == "unavailable"

    @pytest.mark.asyncio
    async def test_http_error_returns_unavailable(self):
        """HTTP error → fallback result."""
        from icaro_api.services.elevation import lookup_elevation
        from icaro_api.config import Settings

        settings = Settings(elevation_url="https://fake.elevation.test/api/v1/lookup")

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "500", request=MagicMock(), response=MagicMock()
        )
        mock_client.get = AsyncMock(return_value=mock_response)

        with patch("icaro_api.services.elevation.httpx.AsyncClient", return_value=mock_client):
            result = await lookup_elevation(48.8566, 2.3522, settings)

        assert result.elevation is None
        assert result.source == "unavailable"

    @pytest.mark.asyncio
    async def test_unavailable_result_has_note(self):
        """Fallback result includes a non-empty note string."""
        from icaro_api.services.elevation import lookup_elevation
        from icaro_api.config import Settings

        settings = Settings(elevation_url="https://fake.elevation.test/api/v1/lookup")

        mock_client = AsyncMock()
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))

        with patch("icaro_api.services.elevation.httpx.AsyncClient", return_value=mock_client):
            result = await lookup_elevation(48.8566, 2.3522, settings)

        assert result.note is not None
        assert len(result.note) > 0


# ---------------------------------------------------------------------------
# ElevationResult model tests
# ---------------------------------------------------------------------------


class TestElevationResult:
    def test_result_with_elevation(self):
        from icaro_api.services.elevation import ElevationResult

        r = ElevationResult(elevation=100.0, source="dem")
        assert r.elevation == 100.0
        assert r.source == "dem"

    def test_result_unavailable(self):
        from icaro_api.services.elevation import ElevationResult

        r = ElevationResult(elevation=None, source="unavailable")
        assert r.elevation is None

    def test_result_with_note(self):
        from icaro_api.services.elevation import ElevationResult

        r = ElevationResult(elevation=None, source="unavailable", note="Service down")
        assert "Service down" in r.note


# ---------------------------------------------------------------------------
# Integration test (task 1.26) — requires real network, skipped in CI
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.asyncio
async def test_real_open_elevation_lookup():
    """Real call to open-elevation.com — skipped unless INTEGRATION_TESTS=1."""
    from icaro_api.services.elevation import lookup_elevation
    from icaro_api.config import Settings

    settings = Settings()  # uses default open-elevation URL
    result = await lookup_elevation(48.8566, 2.3522, settings)
    # Accept either success or graceful fallback (service can be down).
    assert result.elevation is None or isinstance(result.elevation, float)
    assert result.source in ("dem", "unavailable")
