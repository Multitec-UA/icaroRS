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
# Open-Meteo fallback
# ---------------------------------------------------------------------------

_PRIMARY = "https://fake.elevation.test/api/v1/lookup"
_FALLBACK = "https://fake.open-meteo.test/v1/elevation"


def _response(payload=None, status_error=False):
    response = MagicMock()
    if status_error:
        response.raise_for_status.side_effect = httpx.HTTPStatusError(
            "503", request=MagicMock(), response=MagicMock()
        )
    else:
        response.raise_for_status.return_value = None
    response.json.return_value = payload
    return response


def _client(responses_by_url):
    """An AsyncClient double answering each URL with its canned response."""
    client = AsyncMock()
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)

    async def get(url, params=None):
        outcome = responses_by_url[url]
        if isinstance(outcome, Exception):
            raise outcome
        return outcome

    client.get = AsyncMock(side_effect=get)
    return client


class TestOpenMeteoFallback:
    @pytest.mark.asyncio
    async def test_primary_down_uses_open_meteo(self):
        """open-elevation 503 → Open-Meteo answers with its own params and shape."""
        from icaro_api.services.elevation import lookup_elevation
        from icaro_api.config import Settings

        settings = Settings(elevation_url=_PRIMARY, elevation_fallback_url=_FALLBACK)
        client = _client(
            {
                _PRIMARY: _response(status_error=True),
                _FALLBACK: _response({"elevation": [197.0]}),
            }
        )

        with patch("icaro_api.services.elevation.httpx.AsyncClient", return_value=client):
            result = await lookup_elevation(41.7272, 0.0770, settings)

        assert result.elevation == pytest.approx(197.0)
        assert result.source == "dem"
        assert result.note is None
        fallback_call = client.get.await_args_list[-1]
        assert fallback_call.args[0] == _FALLBACK
        assert fallback_call.kwargs["params"] == {"latitude": 41.7272, "longitude": 0.0770}

    @pytest.mark.asyncio
    async def test_primary_success_skips_fallback(self):
        from icaro_api.services.elevation import lookup_elevation
        from icaro_api.config import Settings

        settings = Settings(elevation_url=_PRIMARY, elevation_fallback_url=_FALLBACK)
        client = _client({_PRIMARY: _response({"results": [{"elevation": 432.1}]})})

        with patch("icaro_api.services.elevation.httpx.AsyncClient", return_value=client):
            result = await lookup_elevation(48.8566, 2.3522, settings)

        assert result.elevation == pytest.approx(432.1)
        assert client.get.await_count == 1

    @pytest.mark.asyncio
    async def test_both_down_returns_unavailable(self):
        from icaro_api.services.elevation import lookup_elevation
        from icaro_api.config import Settings

        settings = Settings(elevation_url=_PRIMARY, elevation_fallback_url=_FALLBACK)
        client = _client(
            {
                _PRIMARY: httpx.TimeoutException("timeout"),
                _FALLBACK: _response({"error": True, "reason": "down"}),
            }
        )

        with patch("icaro_api.services.elevation.httpx.AsyncClient", return_value=client):
            result = await lookup_elevation(48.8566, 2.3522, settings)

        assert result.elevation is None
        assert result.source == "unavailable"
        assert result.note

    @pytest.mark.asyncio
    async def test_empty_fallback_url_disables_fallback(self):
        from icaro_api.services.elevation import lookup_elevation
        from icaro_api.config import Settings

        settings = Settings(elevation_url=_PRIMARY, elevation_fallback_url="")
        client = _client({_PRIMARY: _response(status_error=True)})

        with patch("icaro_api.services.elevation.httpx.AsyncClient", return_value=client):
            result = await lookup_elevation(48.8566, 2.3522, settings)

        assert result.source == "unavailable"
        assert client.get.await_count == 1

    def test_default_fallback_is_open_meteo(self):
        from icaro_api.config import Settings

        assert Settings().elevation_fallback_url == "https://api.open-meteo.com/v1/elevation"


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
