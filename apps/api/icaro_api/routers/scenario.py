"""Scenario endpoints — GET /api/scenario/template, POST /api/scenario/validate.

Design §5: PRESETS mapping lives here (UX data, not domain invariant).
Validation reuses pydantic Scenario.model_validate — NOT load_scenario
(that reads files; we validate in-memory dicts).

Routes (all require auth via router-level dependency):
  GET  /api/scenario/template  — starter Scenario dict + PRESETS
  POST /api/scenario/validate  — validate/normalize a scenario dict → 422 on error
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from icaro.scenario import DEFAULT_UNCERTAINTY, Dispersion, Scenario
from icaro_api.auth import require_auth
from icaro_api.config import Settings, get_settings

router = APIRouter(
    prefix="/scenario",
    tags=["scenario"],
    dependencies=[Depends(require_auth)],
)

# ---------------------------------------------------------------------------
# PRESETS — UX sugar: named uncertainty bundles (ADR-2, design §5).
#
# Typical    = DEFAULT_UNCERTAINTY (the icaro-shipped template; never drifts).
# Conservative = wider stds for less predictable/larger rockets.
# Precise    = tighter stds for well-characterised, stable rockets.
# ---------------------------------------------------------------------------

PRESETS: dict[str, dict[str, Any]] = {
    "Typical": {k: v.model_dump() for k, v in DEFAULT_UNCERTAINTY.items()},
    "Conservative": {
        "mass":        {"std": 0.08, "kind": "relative"},
        "inclination": {"std": 3.0,  "kind": "absolute"},
        "heading":     {"std": 3.0,  "kind": "absolute"},
        "wind_factor": {"std": 0.18, "kind": "relative"},
        "thrust":      {"std": 0.05, "kind": "relative"},
        "rail_length": {"std": 0.08, "kind": "relative"},
    },
    "Precise": {
        "mass":        {"std": 0.02, "kind": "relative"},
        "inclination": {"std": 1.0,  "kind": "absolute"},
        "heading":     {"std": 1.0,  "kind": "absolute"},
        "wind_factor": {"std": 0.05, "kind": "relative"},
        "thrust":      {"std": 0.015, "kind": "relative"},
        "rail_length": {"std": 0.02, "kind": "relative"},
    },
}


# ---------------------------------------------------------------------------
# GET /api/scenario/template
# ---------------------------------------------------------------------------


class ScenarioTemplate(Scenario):
    """Response body for GET /api/scenario/template — a starter Scenario plus uncertainty presets."""

    uncertainty_presets: dict[str, dict[str, Dispersion]]


@router.get("/template", response_model=ScenarioTemplate)
def get_scenario_template() -> dict[str, Any]:
    """Return a starter Scenario dict with DEFAULT_UNCERTAINTY and PRESETS.

    The UI uses this as its initial form state — it never starts empty.
    Satisfies AC-RG-2.3, RG-2.2.
    """
    # Build a minimal starter scenario dict: placeholder site + default atmosphere.
    # The "site" values are just illustrative defaults; the user will override them.
    starter = Scenario.model_validate(
        {
            "name": "my_scenario",
            "site": {"latitude": 0.0, "longitude": 0.0, "elevation": None},
            "atmosphere": {"model": "standard_atmosphere"},
            "uncertainty": {k: v.model_dump() for k, v in DEFAULT_UNCERTAINTY.items()},
        }
    )

    result = starter.model_dump()
    # Add presets so the UI never has to hardcode the preset values.
    result["uncertainty_presets"] = PRESETS
    return result


# ---------------------------------------------------------------------------
# POST /api/scenario/validate
# ---------------------------------------------------------------------------

# NOTE: "value_error" is deliberately NOT mapped here. It is the code pydantic
# emits for our own domain field_validators (e.g. the WGS-84 lat/lon range
# checks), whose messages are already human-authored and specific (e.g.
# "Longitude must be between -180 and 180"). Mapping it to a generic string
# would HIDE the better message — the fallthrough below strips the
# "Value error, " prefix and surfaces the domain message verbatim (RG-3.6).
_HUMANIZED_CODES: dict[str, str] = {
    "missing": "This field is required",
    "string_type": "Must be a string",
    "float_parsing": "Must be a number",
    "int_parsing": "Must be an integer",
    "bool_parsing": "Must be true or false",
    "greater_than_equal": "Value is too small",
    "less_than_equal": "Value is too large",
    "literal_error": "Invalid option",
    "enum": "Invalid option",
}


def _humanize_error(err: dict[str, Any]) -> str:
    """Map a pydantic error dict to a human-readable message.

    Falls back to the original pydantic message if no humanized version exists.
    Never returns a Python traceback.
    """
    code = err.get("type", "")
    msg = err.get("msg", "")

    # Use humanized copy if available, else fall back to pydantic's message.
    humanized = _HUMANIZED_CODES.get(code)
    if humanized:
        return humanized
    # Strip "Value error, " prefix that pydantic v2 prepends to model_validator errors.
    if msg.startswith("Value error, "):
        return msg[len("Value error, "):]
    return msg


@router.post("/validate", response_model=Scenario)
def validate_scenario(body: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize a scenario dict.

    On success: returns the normalized Scenario dict (HTTP 200).
    On failure: returns HTTP 422 with field-keyed error list.
    Never leaks a Python traceback (RG-9.4).

    Satisfies AC-RG-2.4, RG-2.3, AC-RG-3.9.
    """
    try:
        scenario = Scenario.model_validate(body)
    except ValidationError as exc:
        errors = []
        for err in exc.errors():
            loc = list(err.get("loc", []))
            # Build a dot-notation field path from the loc tuple.
            field_path = ".".join(str(p) for p in loc if p != "__root__")
            errors.append(
                {
                    "loc": loc,
                    "field": field_path,
                    "message": _humanize_error(err),
                }
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=errors,
        )

    return scenario.model_dump()
