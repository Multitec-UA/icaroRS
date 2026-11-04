"""Elevation lookup — API-layer edge service (ADR-1).

Performs an HTTP GET to an external DEM API (default: open-elevation.com,
with Open-Meteo as the fallback) to retrieve the ground elevation at a given
lat/lon.

Architecture note (ADR-1)
--------------------------
The *rule* "elevation is optional and falls back to the export value" lives in
``packages/icaro`` (Site.elevation is float|None; build_environment uses it).
The *HTTP call* to an external service is network I/O at the edge — it belongs
here, not in the domain package.  Putting it in icaro would force a network
dependency on the domain (icaro must remain pure/offline-installable).

The two providers speak different protocols, so each has its own setting:

* ``ICARO_ELEVATION_URL`` — an open-elevation compatible service
  (``?locations=lat,lon`` → ``{"results": [{"elevation": ...}]}``).
* ``ICARO_ELEVATION_FALLBACK_URL`` — an Open-Meteo compatible service
  (``?latitude=&longitude=`` → ``{"elevation": [...]}``); empty disables it.

Fallback chain
--------------
The primary is tried first; on any error (timeout, HTTP error, parse error)
the Open-Meteo fallback is tried. When both fail:
  → returns ``ElevationResult(elevation=None, source="unavailable", note=...)``.
  → The router returns 503 (per AC-RG-2.9).
  → The UI shows a "please enter elevation manually" note — simulate never blocks.

Usage
-----
>>> from icaro_api.services.elevation import lookup_elevation
>>> result = await lookup_elevation(48.8566, 2.3522, settings)
>>> result.elevation  # float or None
"""

from __future__ import annotations

from dataclasses import dataclass, field

import httpx

from icaro_api.config import Settings

_FALLBACK_NOTE = (
    "Couldn't auto-detect elevation — please enter it manually "
    "or use the value from your export file."
)

_TIMEOUT_SECONDS = 5.0


@dataclass
class ElevationResult:
    """Result of an elevation lookup.

    Parameters
    ----------
    elevation : float or None
        Ground elevation in metres above sea level.
        ``None`` when the lookup failed.
    source : str
        ``"dem"`` on success, ``"unavailable"`` on failure.
    note : str or None
        Human-readable note for the UI (non-empty when source is "unavailable").
    """

    elevation: float | None
    source: str
    note: str | None = field(default=None)


async def lookup_elevation(
    lat: float,
    lon: float,
    settings: Settings,
) -> ElevationResult:
    """Look up ground elevation at *(lat, lon)* via the configured DEM service.

    Parameters
    ----------
    lat : float
        WGS-84 latitude in decimal degrees.
    lon : float
        WGS-84 longitude in decimal degrees.
    settings : Settings
        Application settings — uses ``settings.elevation_url`` as the base URL.

    Returns
    -------
    ElevationResult
        On success: ``{elevation: float, source: "dem"}``.
        On any error: ``{elevation: None, source: "unavailable", note: ...}``.
    """
    async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
        elevation = await _query_open_elevation(client, settings.elevation_url, lat, lon)
        if elevation is None and settings.elevation_fallback_url:
            elevation = await _query_open_meteo(
                client, settings.elevation_fallback_url, lat, lon
            )

    if elevation is None:
        return ElevationResult(elevation=None, source="unavailable", note=_FALLBACK_NOTE)
    return ElevationResult(elevation=elevation, source="dem")


async def _get_json(client: httpx.AsyncClient, url: str, params: dict) -> object:
    response = await client.get(url, params=params)
    response.raise_for_status()
    return response.json()


async def _query_open_elevation(
    client: httpx.AsyncClient, url: str, lat: float, lon: float
) -> float | None:
    """``{"results": [{"elevation": ...}]}``; ``None`` on any error or odd shape."""
    try:
        data = await _get_json(client, url, {"locations": f"{lat},{lon}"})
        results = data.get("results") or []
        if results and results[0].get("elevation") is not None:
            return float(results[0]["elevation"])
    except Exception:  # noqa: BLE001 — any failure falls through to the next provider
        pass
    return None


async def _query_open_meteo(
    client: httpx.AsyncClient, url: str, lat: float, lon: float
) -> float | None:
    """``{"elevation": [...]}``; ``None`` on any error or odd shape."""
    try:
        data = await _get_json(client, url, {"latitude": lat, "longitude": lon})
        values = data.get("elevation") or []
        if values and values[0] is not None:
            return float(values[0])
    except Exception:  # noqa: BLE001 — any failure means no elevation
        pass
    return None
