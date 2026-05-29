"""Scenario YAML loading and validation for icaroRS.

A ``Scenario`` is the user-authored input contract for a simulation: where
the rocket launches from, when (for real-atmosphere models), which atmosphere
model to use (including offline fallback), optional launch rail overrides, and
the uncertainty budget for Monte Carlo dispersion.

This module is PURE domain logic. It does NOT print, log, or call rocketpy.
Loading raises :class:`ScenarioValidationError` on any invalid input — a
descriptive message naming the offending field and the reason.

Usage
-----
>>> from icaro.scenario import load_scenario
>>> scenario = load_scenario("path/to/scenario.yaml")
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import (
    BaseModel,
    field_validator,
    model_validator,
)


# ---------------------------------------------------------------------------
# Public exception
# ---------------------------------------------------------------------------


class ScenarioValidationError(ValueError):
    """Raised by :func:`load_scenario` when a scenario YAML is invalid.

    The message always names the offending field and the reason, so the CLI
    can present it verbatim to the user without further formatting.
    """


# ---------------------------------------------------------------------------
# Pydantic v2 sub-models
# ---------------------------------------------------------------------------


class Site(BaseModel):
    """Launch site coordinates.

    Parameters
    ----------
    latitude : float
        WGS-84 latitude in decimal degrees. Required. Range: -90 to 90.
    longitude : float
        WGS-84 longitude in decimal degrees. Required. Range: -180 to 180.
    elevation : float or None
        Altitude above sea-level in metres. When absent the elevation from the
        export's ``environment`` block is used (REQ-SCN-10).
    """

    latitude: float
    longitude: float
    elevation: float | None = None

    @field_validator("latitude")
    @classmethod
    def _validate_latitude(cls, v: float) -> float:
        if not (-90.0 <= v <= 90.0):
            raise ValueError(
                f"Latitude must be between -90 and 90 degrees (got {v})."
            )
        return v

    @field_validator("longitude")
    @classmethod
    def _validate_longitude(cls, v: float) -> float:
        if not (-180.0 <= v <= 180.0):
            raise ValueError(
                f"Longitude must be between -180 and 180 degrees (got {v})."
            )
        return v


class LaunchDate(BaseModel):
    """UTC launch date and hour.

    Required for real-atmosphere models (forecast, wyoming_sounding).

    Parameters
    ----------
    year, month, day, hour : int
        UTC date and hour of the simulated launch.
    """

    year: int
    month: int
    day: int
    hour: int


_ALLOWED_MODELS: frozenset[str] = frozenset(
    {"forecast", "wyoming_sounding", "standard_atmosphere", "reanalysis"}
)


class Atmosphere(BaseModel):
    """Atmosphere model selection and fallback policy.

    Parameters
    ----------
    model : str
        One of ``forecast``, ``wyoming_sounding``, ``standard_atmosphere``,
        ``reanalysis``. Validated at load time (REQ-SCN-03).
    file : str or None
        For ``forecast``: GFS ensemble name (default ``"GFS"``).
        For ``reanalysis``: path to a local ERA5-compatible .nc file (required
        when model is ``reanalysis``, REQ-SCN-04).
    station : str or None
        Wyoming sounding station id. Required when model is
        ``wyoming_sounding`` (REQ-SCN-05).
    fallback : str
        Atmosphere model to use when the primary fetch fails.  Defaults to
        ``"standard_atmosphere"`` (REQ-SCN-06).
    """

    model: str = "standard_atmosphere"
    file: str | None = None
    station: str | None = None
    fallback: str = "standard_atmosphere"

    @field_validator("model")
    @classmethod
    def _validate_model(cls, v: str) -> str:
        if v not in _ALLOWED_MODELS:
            raise ValueError(
                f"atmosphere.model '{v}' is not valid. "
                f"Allowed values: {sorted(_ALLOWED_MODELS)}"
            )
        return v


class Rail(BaseModel):
    """Optional launch rail parameter overrides.

    All fields are individually optional (REQ-SCN-09). Present values override
    the corresponding fields in the export's ``flight`` block; absent values
    keep the export value.
    """

    length: float | None = None
    inclination: float | None = None
    heading: float | None = None


class Dispersion(BaseModel):
    """Uncertainty dispersion for a single parameter.

    Parameters
    ----------
    std : float
        Standard deviation of the dispersion.
    kind : {"relative", "absolute"}
        ``relative`` — std is a fraction of the nominal value (e.g. 0.05 = 5%).
        ``absolute`` — std is in the same units as the nominal (e.g. 2.0°).
        ``kind`` is REQUIRED; absent ``kind`` is a validation error (REQ-SCN-08).
    """

    std: float
    kind: Literal["relative", "absolute"]


# ---------------------------------------------------------------------------
# DEFAULT_UNCERTAINTY shipped template
# ---------------------------------------------------------------------------


DEFAULT_UNCERTAINTY: dict[str, Dispersion] = {
    "mass": Dispersion(std=0.05, kind="relative"),
    "inclination": Dispersion(std=2.0, kind="absolute"),
    "heading": Dispersion(std=2.0, kind="absolute"),
    "wind_factor": Dispersion(std=0.10, kind="relative"),
    "thrust": Dispersion(std=0.03, kind="relative"),
    "rail_length": Dispersion(std=0.05, kind="relative"),
}


# ---------------------------------------------------------------------------
# Root scenario model
# ---------------------------------------------------------------------------


class Scenario(BaseModel):
    """Root scenario model.  Returned by :func:`load_scenario`.

    Parameters
    ----------
    name : str
        Human-readable label for this scenario (used as default MC output prefix).
    site : Site
        Launch site coordinates.  Required.
    date : LaunchDate or None
        UTC launch date.  Required when atmosphere.model requires it.
    atmosphere : Atmosphere
        Atmosphere model configuration.
    rail : Rail or None
        Optional launch rail parameter overrides.
    uncertainty : dict[str, Dispersion] or None
        Per-parameter dispersion budget.  ``None`` signals "not set in YAML"
        so :func:`load_scenario` can fill DEFAULT_UNCERTAINTY.
    """

    name: str = "unnamed_scenario"
    site: Site
    date: LaunchDate | None = None
    atmosphere: Atmosphere = Atmosphere()
    rail: Rail | None = None
    # None = absent from YAML (→ filled with template in load_scenario).
    # {} = explicitly empty dict (partial override with no params).
    uncertainty: dict[str, Dispersion] | None = None

    @model_validator(mode="after")
    def _cross_field_validation(self) -> "Scenario":
        model = self.atmosphere.model

        # REQ-SCN-02: forecast/wyoming_sounding require a date block.
        if model in {"forecast", "wyoming_sounding"} and self.date is None:
            raise ValueError(
                f"atmosphere.model '{model}' requires a 'date' block "
                "(year, month, day, hour in UTC)."
            )

        # REQ-SCN-04: reanalysis requires atmosphere.file.
        if model == "reanalysis" and not self.atmosphere.file:
            raise ValueError(
                "atmosphere.model 'reanalysis' requires atmosphere.file "
                "to be set to a valid path to an ERA5-compatible .nc file."
            )

        # REQ-SCN-05: wyoming_sounding requires atmosphere.station.
        if model == "wyoming_sounding" and not self.atmosphere.station:
            raise ValueError(
                "atmosphere.model 'wyoming_sounding' requires atmosphere.station "
                "to be set to a valid station id."
            )

        return self


# ---------------------------------------------------------------------------
# Public loader
# ---------------------------------------------------------------------------


def load_scenario(path: str | Path) -> Scenario:
    """Load and validate a scenario YAML file.

    Applies the following merge rule for the uncertainty block (REQ-SCN-07):

    * Absent ``uncertainty`` block → fill ALL keys from :data:`DEFAULT_UNCERTAINTY`.
    * Present ``uncertainty`` block (even if partial) → use ONLY the listed
      entries; do NOT backfill missing sub-keys from the template.

    Parameters
    ----------
    path : str or Path
        Filesystem path to the scenario ``.yaml`` file.

    Returns
    -------
    Scenario
        Fully validated scenario object.

    Raises
    ------
    ScenarioValidationError
        If the file does not exist, is not valid YAML, or fails any field
        validation.  The message names the offending field and the reason.
    """
    path = Path(path)

    # --- Parse YAML -------------------------------------------------------
    try:
        raw: Any = yaml.safe_load(path.read_text())
    except FileNotFoundError:
        raise ScenarioValidationError(
            f"Scenario file not found: {path}"
        )
    except yaml.YAMLError as exc:
        raise ScenarioValidationError(
            f"Scenario file '{path}' is not valid YAML: {exc}"
        )

    if not isinstance(raw, dict):
        raise ScenarioValidationError(
            f"Scenario file '{path}' must be a YAML mapping at the top level."
        )

    # --- Detect whether uncertainty block was present in YAML --------------
    uncertainty_in_yaml: bool = "uncertainty" in raw

    # --- Validate via pydantic --------------------------------------------
    from pydantic import ValidationError  # local import to keep pydantic internal

    try:
        scenario = Scenario.model_validate(raw)
    except ValidationError as exc:
        # Convert pydantic's structured errors into a single human message.
        messages = []
        for err in exc.errors():
            loc = " → ".join(str(l) for l in err["loc"])
            msg = err["msg"]
            messages.append(f"  [{loc}]: {msg}")
        raise ScenarioValidationError(
            "Scenario validation failed:\n" + "\n".join(messages)
        ) from exc

    # --- Apply uncertainty template rule (REQ-SCN-07) ---------------------
    if not uncertainty_in_yaml:
        # Absent block → fill from template (copy so callers can't mutate defaults).
        object.__setattr__(
            scenario,
            "uncertainty",
            dict(DEFAULT_UNCERTAINTY),
        )
    # else: partial or full block → pydantic already parsed it; keep as-is (no backfill).

    return scenario
