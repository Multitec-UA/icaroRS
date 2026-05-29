"""Elevation lookup — API-layer edge service (ADR-1).

Performs an HTTP GET to an external DEM API (default: open-elevation.com)
to retrieve the ground elevation at a given lat/lon.

Architecture note (ADR-1)
--------------------------
The *rule* "elevation is optional and falls back to the export value" lives in
``packages/icaro`` (Site.elevation is float|None; build_environment uses it).
The *HTTP call* to an external service is network I/O at the edge — it belongs
here, not in the domain package.  Putting it in icaro would force a network
dependency on the domain (icaro must remain pure/offline-installable).

URL is env-configurable (``ICARO_ELEVATION_URL``) so the provider can be
swapped without a code change (open-elevation ↔ Open-Meteo elevation).

Fallback chain
--------------
On any error (timeout, HTTP error, parse error):
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
    url = settings.elevation_url
    params = {"locations": f"{lat},{lon}"}

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_SECONDS) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            data = response.json()

            # open-elevation / Open-Meteo elevation response shape:
            # {"results": [{"latitude": ..., "longitude": ..., "elevation": ...}]}
            results = data.get("results") or []
            if results and results[0].get("elevation") is not None:
                elevation = float(results[0]["elevation"])
                return ElevationResult(elevation=elevation, source="dem")

            # Unexpected shape — treat as unavailable
            return ElevationResult(
                elevation=None,
                source="unavailable",
                note=_FALLBACK_NOTE,
            )

    except Exception:  # noqa: BLE001
        # Any error (timeout, HTTP, parse) → graceful fallback.
        return ElevationResult(
            elevation=None,
            source="unavailable",
            note=_FALLBACK_NOTE,
        )
