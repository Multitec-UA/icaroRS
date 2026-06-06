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
        Default: open-elevation public instance.
    basic_user : str
        HTTP Basic username loaded from env (RG-8.2).
    basic_pass : str
        HTTP Basic password loaded from env (RG-8.2).
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
    """

    results_dir: Path = Path(".icaro_runs")
    ork_jar: Path | None = None
    elevation_url: str = "https://api.open-elevation.com/api/v1/lookup"
    basic_user: str = "icaro"
    basic_pass: str = "changeme"
    allow_forecast: bool = True
    gcs_bucket: str | None = None
    firestore_project: str | None = None
    firestore_database: str = "(default)"

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
