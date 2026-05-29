"""Server-rendered Jinja2 wizard route handlers.

Routes (all require auth — same require_auth dependency as /api/* routes):
  GET  /                     — Step 1: upload .ork
  GET  /step2                — Step 2: site + date
  POST /step2                — Step 2: validate + advance to Step 3
  GET  /step3                — Step 3: advanced options
  POST /step3                — Step 3: validate scenario + trigger simulate
  GET  /results/{run_id}     — Results page (renders result.json)

State management: wizard state (export_id, partial scenario, launch_datetime)
is carried via hidden form fields on POST and query parameters on GET.
This keeps the server stateless and avoids signed cookies / itsdangerous dep.

Architecture note (RG-1.4, RG-1.5):
  - These handlers reuse the API LAYER's own route functions
    (``scenario.validate_scenario``, ``scenario.get_scenario_template``,
    ``simulate.run_simulate``) by calling them directly in-process. Those
    functions ARE the API surface — they call icaro; the UI never imports
    rocketpy/rocketserializer/icaro for domain decisions itself, so the
    thin-surface boundary holds (ui → api handler → icaro).
  - We deliberately do NOT make an HTTP/ASGI round-trip to ourselves: the UI
    runs in the same process as the API, so an in-process function call is the
    same code path without re-creating the app or paying a self-request.
  - Validation FAILS CLOSED: any error resolving validation yields a non-empty
    error list (treated as invalid), never a silent pass.
  - Exception: for the results page, we read result.json directly from the
    run dir (filesystem, not icaro domain code) which is fine — it's I/O on
    our own output, not a domain computation.

Auth (RG-8.1): require_auth is applied at router level so the browser's Basic
creds (set once on the first 401) cover both HTML pages and same-origin XHR.

No raw errors to user (RG-9.4): 422 from /api/scenario/validate re-renders
the step with _field_error.html inline — never a traceback.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from icaro_api.auth import require_auth
from icaro_api.config import Settings, get_settings
from icaro_api.routers.scenario import get_scenario_template as _api_template
from icaro_api.routers.scenario import validate_scenario as _api_validate
from icaro_api.routers.simulate import SimulateRequest
from icaro_api.routers.simulate import run_simulate as _api_simulate
from icaro_api.runs import resolve_run_dir
from icaro_api.serialize import _SCALAR_ATTR_MAP  # presentation map (display order)

# ---------------------------------------------------------------------------
# Templates setup
# ---------------------------------------------------------------------------

_TEMPLATES_DIR = Path(__file__).parent.parent / "templates"
templates = Jinja2Templates(directory=str(_TEMPLATES_DIR))

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

router = APIRouter(
    tags=["ui"],
    dependencies=[Depends(require_auth)],
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _ordered_label_list() -> list[tuple[str, dict[str, str]]]:
    """Return scalars in _SCALAR_ATTR_MAP display order as (key, {label, unit}) pairs."""
    return [(output_key, {"label": label, "unit": unit})
            for (_, output_key, label, unit) in _SCALAR_ATTR_MAP]


def _html(request: Request, template_name: str, ctx: dict[str, Any]) -> HTMLResponse:
    """Render a Jinja2 template to an HTMLResponse.

    Uses the Starlette 1.x API where request is the first positional arg
    and context is passed separately (without request inside the dict).
    """
    return templates.TemplateResponse(request=request, name=template_name, context=ctx)


# ---------------------------------------------------------------------------
# GET / — Step 1: Upload rocket
# ---------------------------------------------------------------------------


@router.get("/", response_class=HTMLResponse)
def step1_get(
    request: Request,
    export_id: str | None = None,
) -> HTMLResponse:
    """Render Step 1 — rocket upload page.

    If export_id is already set (user navigated back), render the done state.
    """
    return _html(request, "step1_rocket.html", {
        "active_step": 1,
        "export_id": export_id,
        "manifest": None,
        "errors": [],
    })


# ---------------------------------------------------------------------------
# GET /step2 — Step 2: Site + date (initial render)
# ---------------------------------------------------------------------------


@router.get("/step2", response_class=HTMLResponse)
def step2_get(
    request: Request,
    export_id: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    elevation: float | None = None,
    launch_datetime: str | None = None,
    atmosphere_model: str | None = None,
) -> HTMLResponse:
    """Render Step 2 — site and date page.

    All parameters come from query string (carry-forward from GET /step2
    links or back-navigation from Step 3).
    """
    scenario = _build_partial_scenario(latitude, longitude, elevation, atmosphere_model)
    return _html(request, "step2_basics.html", {
        "active_step": 2,
        "export_id": export_id,
        "scenario": scenario,
        "launch_datetime": launch_datetime,
        "errors": [],
    })


# ---------------------------------------------------------------------------
# POST /step2 — Step 2: Validate + carry to Step 3
# ---------------------------------------------------------------------------


@router.post("/step2", response_class=HTMLResponse)
def step2_post(
    request: Request,
    settings: Settings = Depends(get_settings),
    export_id: str = Form(default=""),
    latitude: str = Form(default=""),
    longitude: str = Form(default=""),
    elevation: str = Form(default=""),
    launch_datetime: str = Form(default=""),
    atmosphere_model: str = Form(default="standard_atmosphere"),
) -> HTMLResponse:
    """Handle Step 2 form POST: parse, validate site, advance to Step 3.

    Returns Step 2 with inline errors (re-render) if validation fails (RG-9.4).
    Returns Step 3 form on success.
    """
    errors: list[dict[str, str]] = []

    lat_f = _parse_float(latitude)
    lon_f = _parse_float(longitude)
    elev_f = _parse_float(elevation)

    if lat_f is None and latitude.strip():
        errors.append({"field": "site.latitude", "message": "Latitude must be a number."})
    if lon_f is None and longitude.strip():
        errors.append({"field": "site.longitude", "message": "Longitude must be a number."})

    if errors:
        scenario = _build_partial_scenario(lat_f, lon_f, elev_f, atmosphere_model)
        return _html(request, "step2_basics.html", {
            "active_step": 2,
            "export_id": export_id,
            "scenario": scenario,
            "launch_datetime": launch_datetime,
            "errors": errors,
        })

    # Validate site bounds with /api/scenario/validate (thin surface — RG-1.5).
    # We build a minimal scenario dict for validation.
    partial_scenario_body: dict[str, Any] = {
        "name": "wizard",
        "site": {
            "latitude":  lat_f if lat_f is not None else 0.0,
            "longitude": lon_f if lon_f is not None else 0.0,
        },
        "atmosphere": {"model": atmosphere_model or "standard_atmosphere"},
        "uncertainty": {},
    }
    if elev_f is not None:
        partial_scenario_body["site"]["elevation"] = elev_f

    api_errors = _validate_via_api(partial_scenario_body, settings)
    if api_errors:
        scenario = _build_partial_scenario(lat_f, lon_f, elev_f, atmosphere_model)
        return _html(request, "step2_basics.html", {
            "active_step": 2,
            "export_id": export_id,
            "scenario": scenario,
            "launch_datetime": launch_datetime,
            "errors": api_errors,
        })

    # Success — render Step 3
    scenario = _build_partial_scenario(lat_f, lon_f, elev_f, atmosphere_model)
    return _html(request, "step3_advanced.html", {
        "active_step": 3,
        "export_id": export_id,
        "scenario": scenario,
        "launch_datetime": launch_datetime,
        "selected_preset": "Typical",
        "atm_override": None,
        "errors": [],
    })


# ---------------------------------------------------------------------------
# GET /step3 — Step 3: Advanced options (initial render / back-nav)
# ---------------------------------------------------------------------------


@router.get("/step3", response_class=HTMLResponse)
def step3_get(
    request: Request,
    export_id: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    elevation: float | None = None,
    launch_datetime: str | None = None,
    atmosphere_model: str | None = None,
) -> HTMLResponse:
    """Render Step 3 — advanced options page (collapsed by default, AC-RG-3.6)."""
    scenario = _build_partial_scenario(latitude, longitude, elevation, atmosphere_model)
    return _html(request, "step3_advanced.html", {
        "active_step": 3,
        "export_id": export_id,
        "scenario": scenario,
        "launch_datetime": launch_datetime,
        "selected_preset": "Typical",
        "atm_override": None,
        "errors": [],
    })


# ---------------------------------------------------------------------------
# POST /step3 — Validate scenario + trigger simulate + redirect to results
# ---------------------------------------------------------------------------


@router.post("/step3", response_class=HTMLResponse)
def step3_post(
    request: Request,
    settings: Settings = Depends(get_settings),
    export_id: str = Form(default=""),
    latitude: str = Form(default=""),
    longitude: str = Form(default=""),
    elevation: str = Form(default=""),
    launch_datetime: str = Form(default=""),
    atmosphere_model_hidden: str = Form(alias="atmosphere_model", default="standard_atmosphere"),
    atmosphere_override: str = Form(default=""),
    uncertainty_preset: str = Form(default="Typical"),
    # uncertainty table fields (Customize only)
    unc_mass_std: str = Form(default=""),
    unc_mass_kind: str = Form(default="relative"),
    unc_inclination_std: str = Form(default=""),
    unc_inclination_kind: str = Form(default="absolute"),
    unc_heading_std: str = Form(default=""),
    unc_heading_kind: str = Form(default="absolute"),
    unc_wind_factor_std: str = Form(default=""),
    unc_wind_factor_kind: str = Form(default="relative"),
    unc_thrust_std: str = Form(default=""),
    unc_thrust_kind: str = Form(default="relative"),
    unc_rail_length_std: str = Form(default=""),
    unc_rail_length_kind: str = Form(default="relative"),
    # rail overrides
    rail_length: str = Form(default=""),
    rail_inclination: str = Form(default=""),
    rail_heading: str = Form(default=""),
) -> HTMLResponse:
    """Handle Step 3 POST: build full scenario, validate, simulate, redirect to results.

    On validation failure: re-render Step 3 with inline errors (RG-9.4).
    On simulation success: render results page.
    """
    lat_f = _parse_float(latitude)
    lon_f = _parse_float(longitude)
    elev_f = _parse_float(elevation)
    atm_model = atmosphere_override.strip() or atmosphere_model_hidden.strip() or "standard_atmosphere"

    # Resolve uncertainty from preset or custom fields
    uncertainty = _resolve_uncertainty(
        preset_name=uncertainty_preset,
        custom={
            "mass":        (unc_mass_std,        unc_mass_kind),
            "inclination": (unc_inclination_std, unc_inclination_kind),
            "heading":     (unc_heading_std,     unc_heading_kind),
            "wind_factor": (unc_wind_factor_std, unc_wind_factor_kind),
            "thrust":      (unc_thrust_std,      unc_thrust_kind),
            "rail_length": (unc_rail_length_std, unc_rail_length_kind),
        },
        settings=settings,
    )

    # Build full scenario body
    scenario_body: dict[str, Any] = {
        "name": "wizard",
        "site": {
            "latitude":  lat_f if lat_f is not None else 0.0,
            "longitude": lon_f if lon_f is not None else 0.0,
        },
        "atmosphere": {"model": atm_model},
        "uncertainty": uncertainty,
    }
    if elev_f is not None:
        scenario_body["site"]["elevation"] = elev_f
    if launch_datetime.strip():
        scenario_body["site"]["launch_date"] = launch_datetime.strip()

    # Rail overrides (optional)
    rail_l = _parse_float(rail_length)
    rail_i = _parse_float(rail_inclination)
    rail_h = _parse_float(rail_heading)
    if any(v is not None for v in (rail_l, rail_i, rail_h)):
        rail_dict: dict[str, Any] = {}
        if rail_l is not None:
            rail_dict["length"] = rail_l
        if rail_i is not None:
            rail_dict["inclination"] = rail_i
        if rail_h is not None:
            rail_dict["heading"] = rail_h
        scenario_body["rail"] = rail_dict

    # Validate via API (RG-1.5 — thin surface, no direct Scenario import for validation)
    api_errors = _validate_via_api(scenario_body, settings)
    if api_errors:
        scenario_obj = _build_partial_scenario(lat_f, lon_f, elev_f, atm_model)
        return _html(request, "step3_advanced.html", {
            "active_step": 3,
            "export_id": export_id,
            "scenario": scenario_obj,
            "launch_datetime": launch_datetime,
            "selected_preset": uncertainty_preset,
            "atm_override": atmosphere_override.strip() or None,
            "errors": api_errors,
        })

    # Trigger simulate via API
    try:
        simulate_result = _simulate_via_api(export_id, scenario_body, settings)
    except _SimulateError as exc:
        # Re-render step3 with the simulation error (no traceback — RG-9.4)
        scenario_obj = _build_partial_scenario(lat_f, lon_f, elev_f, atm_model)
        return _html(request, "step3_advanced.html", {
            "active_step": 3,
            "export_id": export_id,
            "scenario": scenario_obj,
            "launch_datetime": launch_datetime,
            "selected_preset": uncertainty_preset,
            "atm_override": atmosphere_override.strip() or None,
            "errors": [{"field": "", "message": str(exc)}],
        })

    # Render results page
    run_id = simulate_result.get("run_id", "")
    return _html(request, "results.html", {
        "active_step": None,
        "run_id": run_id,
        "export_id": export_id,
        "scalars": simulate_result.get("scalars", {}),
        "plot_urls": simulate_result.get("plot_urls", []),
        "warnings": simulate_result.get("warnings", []),
        "label_map": _ordered_label_list(),
    })


# ---------------------------------------------------------------------------
# GET /results/{run_id} — Results page
# ---------------------------------------------------------------------------


@router.get("/results/{run_id}", response_class=HTMLResponse)
def results_get(
    run_id: str,
    request: Request,
    export_id: str | None = None,
    settings: Settings = Depends(get_settings),
) -> HTMLResponse:
    """Render the results page for a completed run.

    Reads result.json from the run directory (no domain import — just I/O).
    Returns 404 if the run does not exist.
    """
    run_dir = resolve_run_dir(settings.results_dir, run_id)
    if run_dir is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found.")

    result_file = run_dir / "result.json"
    if not result_file.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Result not found.")

    try:
        result = json.loads(result_file.read_text())
    except Exception:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not read result.",
        )

    return _html(request, "results.html", {
        "active_step": None,
        "run_id": run_id,
        "export_id": export_id or "",
        "scalars": result.get("scalars", {}),
        "plot_urls": result.get("plot_urls", []),
        "warnings": result.get("warnings", []),
        "label_map": _ordered_label_list(),
    })


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _parse_float(value: str | None) -> float | None:
    """Parse a string to float; return None on failure."""
    if not value or not str(value).strip():
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _build_partial_scenario(
    lat: float | None,
    lon: float | None,
    elevation: float | None,
    atmosphere_model: str | None,
) -> Any:
    """Build a simple namespace-like object for template access.

    Returns a simple object with .site and .atmosphere attributes that the
    templates can access via dot notation.
    """

    class _Site:
        def __init__(self) -> None:
            self.latitude  = lat
            self.longitude = lon
            self.elevation = elevation

    class _Atmosphere:
        def __init__(self) -> None:
            self.model = atmosphere_model or "standard_atmosphere"

    class _Scenario:
        def __init__(self) -> None:
            self.site       = _Site()
            self.atmosphere = _Atmosphere()
            self.uncertainty: dict[str, Any] = {}
            self.rail: Any = None

    return _Scenario()


def _validate_via_api(
    scenario_body: dict[str, Any],
    settings: Settings,
) -> list[dict[str, str]]:
    """Validate a scenario dict via the API layer's ``validate_scenario``.

    Calls the API route function directly in-process (no HTTP round-trip to
    ourselves) — the function IS the API surface and reuses pydantic + the
    icaro domain, so the thin-surface boundary holds (RG-1.5).

    Returns an empty list on success; a list of ``{field, message}`` dicts on
    a 422.  FAILS CLOSED: any unexpected error yields a non-empty error list
    (treated as invalid) — never a silent pass.  Never leaks a traceback
    (RG-9.4).
    """
    try:
        _api_validate(scenario_body)
        return []
    except HTTPException as exc:
        if exc.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY and isinstance(
            exc.detail, list
        ):
            return [
                {
                    "field": err.get("field", ""),
                    "message": err.get("message", "Invalid value"),
                }
                for err in exc.detail
            ]
        # Any other HTTP error from validation → surface a generic, non-empty
        # message (fail closed), no traceback.
        return [
            {"field": "", "message": "Could not validate the scenario. Please review your inputs."}
        ]
    except Exception:  # noqa: BLE001
        # Fail CLOSED on the unexpected: a non-empty error list means the form
        # is treated as invalid rather than silently accepted (RG-9.4).
        return [
            {"field": "", "message": "Could not validate the scenario. Please try again."}
        ]


class _SimulateError(Exception):
    """Raised by _simulate_via_api on failure; message is user-friendly."""


def _simulate_via_api(
    export_id: str,
    scenario_body: dict[str, Any],
    settings: Settings,
) -> dict[str, Any]:
    """Run a simulation via the API layer's ``run_simulate`` route function.

    Calls the route function directly in-process (no self HTTP round-trip);
    ``run_simulate`` holds the simulate lock and serializes the Flight.

    Raises :class:`_SimulateError` with a user-friendly message on failure.
    Never surfaces a traceback (RG-9.4).
    """
    try:
        request = SimulateRequest(export_id=export_id, scenario=scenario_body)
        return _api_simulate(request, settings)
    except HTTPException as exc:
        if exc.status_code == status.HTTP_503_SERVICE_UNAVAILABLE:
            hint = ""
            if isinstance(exc.detail, dict):
                hint = exc.detail.get("hint", "")
            msg = "Simulation service unavailable."
            if hint:
                msg += " " + hint
            raise _SimulateError(msg)
        if exc.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY:
            raise _SimulateError(
                "The scenario has validation errors. Please review your inputs."
            )
        if exc.status_code == status.HTTP_404_NOT_FOUND:
            raise _SimulateError(
                "The uploaded rocket could not be found. Please upload it again."
            )
        raise _SimulateError("Simulation failed. Please try again.")
    except _SimulateError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _SimulateError("Simulation service error. Please try again.") from exc


def _resolve_uncertainty(
    preset_name: str,
    custom: dict[str, tuple[str, str]],
    settings: Settings,
) -> dict[str, Any]:
    """Return an uncertainty dict from a preset name or custom field values.

    If preset_name is 'Customize', uses the custom field values from the form.
    Otherwise, fetches the preset from /api/scenario/template.
    Returns an empty dict on any failure (simulate router will use defaults).
    """
    if preset_name == "Customize":
        result: dict[str, Any] = {}
        for key, (std_str, kind) in custom.items():
            std_f = _parse_float(std_str)
            if std_f is not None:
                result[key] = {"std": std_f, "kind": kind}
        return result

    # Fetch preset from the template route function (RG-1.5 — values come from
    # the API layer's PRESETS, never hardcoded in the UI).
    try:
        data = _api_template()
        preset = data.get("uncertainty_presets", {}).get(preset_name)
        if preset:
            return preset
    except Exception:  # noqa: BLE001
        pass

    return {}
