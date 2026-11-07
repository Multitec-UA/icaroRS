"""Application settings loaded from environment variables.

All configuration is centralised here so that routers and services never
read ``os.environ`` directly.  Inject via the ``get_settings()`` FastAPI
dependency defined in ``deps.py``.

Usage
-----
>>> from icaro_api.config import Settings, get_settings
>>> settings = get_settings()
>>> print(settings.results_dir)
"""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration sourced from environment variables.

    Parameters
    ----------
    results_dir : Path
        Where per-run directories (PNGs + result.json) are written.
        Default: ``.icaro_runs`` relative to the working directory.
    ork_jar : Path | None
        Path to the OpenRocket JAR required by ``POST /api/convert``.
        Absent → /api/convert returns 503 (ConvertUnavailableError).
    elevation_url : str
        Base URL for the elevation DEM service.
        Default: open-elevation public instance. The service must speak the
        open-elevation protocol (``?locations=lat,lon`` → ``results[0].elevation``).
    elevation_fallback_url : str
        Open-Meteo elevation endpoint queried when the primary service fails
        (``?latitude=&longitude=`` → ``elevation[0]``). An empty string
        disables the fallback.
    session_cookie_max_age_days : int
        Lifetime of the Identity Platform session cookie minted by
        ``POST /api/auth/session``. Firebase Auth caps this at 14 days.
    session_cookie_secure : bool
        Whether the session cookie carries the ``Secure`` attribute. Must be
        ``True`` in any deployment served over HTTPS; set ``False`` only for
        local HTTP development (browsers drop ``Secure`` cookies over HTTP).
    allow_forecast : bool
        Gate for outbound GFS forecast network requests.
        Set ``False`` to force standard_atmosphere without network calls.
    gcs_bucket : str | None
        GCS bucket name for artifact storage.  When set, ``get_storage()``
        returns ``GcsStorage``; when ``None``, ``LocalFsStorage`` is used
        (dev/CI only — NEVER use ``None`` in production).
    firestore_project : str | None
        GCP project id for Firestore metadata.  When set, ``get_db()``
        returns ``FirestoreDb``; when ``None``, ``InMemoryDb`` is used
        (dev/CI only).
    firestore_database : str
        Firestore database name.  Default ``"(default)"`` matches the
        native-mode default database.
    montecarlo_min_n, montecarlo_max_n : int
        Inclusive bounds on ``n`` for ``POST /api/montecarlo`` (default
        10..500, ≈ 4–16 min per run). The CLI has no limit.
    interop_orgs : str
        ``ICARO_INTEROP_ORGS``: comma-separated organisation ids allowed to
        exchange flights with the MT1 telemetry service (real flight interop,
        see ``apps/api/README.md``). Their simulations are published to
        ``interop_simulations`` and their users see ``interop_real_flights``.
        Empty (the default) turns the feature off.
    """

    results_dir: Path = Path(".icaro_runs")
    ork_jar: Path | None = None
    elevation_url: str = "https://api.open-elevation.com/api/v1/lookup"
    elevation_fallback_url: str = "https://api.open-meteo.com/v1/elevation"
    session_cookie_max_age_days: int = 5
    session_cookie_secure: bool = True
    allow_forecast: bool = True
    gcs_bucket: str | None = None
    firestore_project: str | None = None
    firestore_database: str = "(default)"
    montecarlo_min_n: int = 10
    montecarlo_max_n: int = 500
    interop_orgs: str = ""

    def interop_enabled_for(self, org_id: str | None) -> bool:
        """Whether *org_id* takes part in the real flight interop."""
        from icaro_api.services.interop import interop_org_ids

        return bool(org_id) and org_id in interop_org_ids(self.interop_orgs)

    model_config = SettingsConfigDict(
        env_prefix="ICARO_",
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )


@lru_cache
def get_settings() -> Settings:
    """Return the singleton Settings instance (cached after first call)."""
    return Settings()
