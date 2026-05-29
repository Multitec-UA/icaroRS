"""Simulation use-cases for icaroRS.

Turns a RocketSerializer export (the ``parameters.json`` + CSV files produced
from an OpenRocket ``.ork`` file) into a fully-built, solved RocketPy
``Flight``.

This module is PURE domain logic: it builds objects and returns them. It does
NOT print, format, or decide how results are shown — that is the job of the
delivery layer (CLI, API, web). Keep it that way: if you find yourself adding a
``print`` here, it belongs in the caller instead.
"""

from __future__ import annotations

import json
import os
import warnings
from pathlib import Path
from typing import TYPE_CHECKING

from rocketpy import Environment, Flight, Rocket, SolidMotor

if TYPE_CHECKING:
    from icaro.scenario import Scenario


def _is_empty(value) -> bool:
    return value is None or value == {} or value == []


def _load_drag_curve(path: str | os.PathLike) -> list[tuple[float, float]]:
    """Read a ``"Mach, Cd"`` CSV into a curve sorted and unique by Mach.

    A dict naturally overwrites duplicate Mach keys (keeping one Cd per Mach);
    RocketPy needs strictly-monotonic Mach values or interpolation breaks.
    """
    curve: dict[float, float] = {}
    with open(path, "r") as f:
        for line in f:
            mach, cd = line.strip().split(",")
            curve[float(mach)] = float(cd)
    return sorted(curve.items())


def build_environment(
    env_data: dict,
    scenario: "Scenario | None" = None,
) -> Environment:
    """Build a RocketPy ``Environment`` from export data and an optional scenario.

    When ``scenario`` is ``None`` (backward-compat mode), the standard ICAO
    atmosphere is used with no network calls.

    When ``scenario`` is provided:
    - Site coordinates and elevation come from ``scenario.site`` (elevation
      falls back to ``env_data["elevation"]`` if absent in the scenario).
    - If ``scenario.date`` is present, ``env.set_date(...)`` is called before
      any date-dependent atmosphere model (required for GFS / wyoming_sounding).
    - Atmosphere model selection follows ``scenario.atmosphere.model``.
    - On any fetch failure, a :class:`UserWarning` is emitted identifying the
      model, the failure reason, and the fallback, then the fallback model is
      used (REQ-SIM-03, REQ-XC-04). The simulation never crashes over weather.

    Parameters
    ----------
    env_data : dict
        The ``environment`` sub-dict from ``parameters.json``.
    scenario : Scenario or None
        Validated scenario from :func:`icaro.scenario.load_scenario`.

    Returns
    -------
    rocketpy.Environment
        Fully constructed and atmosphere-set environment object.
    """
    if scenario is None:
        # Backward-compat path: standard atmosphere, no scenario overrides.
        env = Environment(
            elevation=env_data["elevation"],
            latitude=env_data["latitude"],
            longitude=env_data["longitude"],
        )
        env.set_atmospheric_model(type="standard_atmosphere")
        return env

    # --- Resolve coordinates: scenario.site overrides export values. ------
    lat = scenario.site.latitude
    lon = scenario.site.longitude
    elev = (
        scenario.site.elevation
        if scenario.site.elevation is not None
        else env_data["elevation"]
    )

    env = Environment(latitude=lat, longitude=lon, elevation=elev)

    # --- Set date BEFORE date-dependent atmosphere models. ----------------
    if scenario.date is not None:
        d = scenario.date
        env.set_date((d.year, d.month, d.day, d.hour), timezone="UTC")

    # --- Atmosphere model selection. -------------------------------------
    atm = scenario.atmosphere
    model = atm.model

    # HIRESW / GEFS: upstream NOMADS is disabled — reject early.
    if model in {"HIRESW", "GEFS"}:
        raise ValueError(
            f"Atmosphere model '{model}' is not supported: the upstream NOMADS "
            "server that provides HIRESW/GEFS data is disabled. "
            "Use 'forecast' (GFS) or 'standard_atmosphere' instead."
        )

    if model == "standard_atmosphere":
        env.set_atmospheric_model(type="standard_atmosphere")
        return env

    # Date-dependent models: try/except with fallback.
    fallback = atm.fallback or "standard_atmosphere"

    _MODEL_KWARGS: dict[str, dict] = {
        "forecast": {"type": "forecast", "file": atm.file or "GFS"},
        "wyoming_sounding": {
            "type": "wyoming_sounding",
            # The sounding URL is built from station + date by rocketpy.
            "file": atm.station,
        },
        "reanalysis": {"type": "reanalysis", "file": atm.file},
    }

    # Resolve fetch kwargs first. An unsupported model is a CLEAR error, not a
    # weather fallback (mirrors the HIRESW/GEFS rejection above) — masking it
    # would hide a real bug.
    try:
        kwargs = _MODEL_KWARGS[model]
    except KeyError as exc:
        raise ValueError(f"Unsupported atmosphere model '{model}'.") from exc

    # Only a genuine fetch/IO failure triggers the fallback. We deliberately do
    # NOT catch bare Exception: a programming error must surface, never disguise
    # itself as a weather problem and send us hunting a network bug that isn't
    # there.
    try:
        env.set_atmospheric_model(**kwargs)
    except (RuntimeError, OSError, ValueError) as exc:
        warnings.warn(
            f"Atmosphere fetch for model '{model}' failed "
            f"({type(exc).__name__}: {exc}); "
            f"falling back to '{fallback}'.",
            UserWarning,
            stacklevel=2,
        )
        env.set_atmospheric_model(type=fallback)

    return env


def _build_environment(env_data: dict) -> Environment:
    """Legacy private wrapper — kept for any internal references."""
    return build_environment(env_data, scenario=None)


def _build_motor(motor_data: dict, export_dir: Path) -> SolidMotor:
    return SolidMotor(
        thrust_source=str(export_dir / "thrust_source.csv"),
        dry_mass=motor_data["dry_mass"],
        dry_inertia=tuple(motor_data["dry_inertia"]),
        nozzle_radius=motor_data["nozzle_radius"],
        grain_number=motor_data["grain_number"],
        grain_density=motor_data["grain_density"],
        grain_outer_radius=motor_data["grain_outer_radius"],
        grain_initial_inner_radius=motor_data["grain_initial_inner_radius"],
        grain_initial_height=motor_data["grain_initial_height"],
        grain_separation=motor_data["grain_separation"],
        grains_center_of_mass_position=motor_data["grains_center_of_mass_position"],
        center_of_dry_mass_position=motor_data["center_of_dry_mass_position"],
        nozzle_position=motor_data["nozzle_position"],
        throat_radius=motor_data["throat_radius"],
        coordinate_system_orientation=motor_data["coordinate_system_orientation"],
    )


def _build_rocket(params: dict, motor: SolidMotor, export_dir: Path) -> Rocket:
    rocket_data = params["rocket"]
    drag_curve = _load_drag_curve(export_dir / "drag_curve.csv")

    rocket = Rocket(
        radius=rocket_data["radius"],
        mass=rocket_data["mass"],
        # The export gave inertia as [axial, axial, transverse] (e.g. small,
        # small, large). RocketPy expects (I_11, I_22, I_33) with 11/22
        # transverse and 33 axial — so the two largest go to 11/22, the
        # smallest to 33.
        inertia=(
            max(rocket_data["inertia"]),
            max(rocket_data["inertia"]),
            min(rocket_data["inertia"]),
        ),
        power_off_drag=drag_curve,
        power_on_drag=drag_curve,
        center_of_mass_without_motor=rocket_data["center_of_mass_without_propellant"],
        coordinate_system_orientation=rocket_data["coordinate_system_orientation"],
    )
    rocket.add_motor(motor, position=params["motors"]["position"])

    # Nosecone (single, flat dict). OpenRocket "ellipsoid" maps to RocketPy
    # "elliptical".
    nose_data = params["nosecones"]
    nose_kind = "elliptical" if nose_data["kind"] == "ellipsoid" else nose_data["kind"]
    rocket.add_nose(
        length=nose_data["length"],
        kind=nose_kind,
        position=nose_data["position"],
        name=nose_data["name"],
        base_radius=nose_data["base_radius"],
    )

    # Tails (indexed dict, may be empty).
    for tail in params.get("tails", {}).values():
        rocket.add_tail(
            top_radius=tail["top_radius"],
            bottom_radius=tail["bottom_radius"],
            length=tail["length"],
            position=tail["position"],
            name=tail.get("name", "Tail"),
        )

    # Fins (indexed dicts). Free-form, trapezoidal and elliptical are all
    # handled so any serialized rocket builds.
    trapezoidal_fins = params.get("trapezoidal_fins", {})
    elliptical_fins = params.get("elliptical_fins", {})
    freeform_fins = params.get("freeform_fins", {})

    for fin in freeform_fins.values():
        rocket.add_free_form_fins(
            n=fin["number"],
            # shape_points come straight from the serializer (OpenRocket
            # finpoints, +x toward the tail — already RocketPy's convention).
            shape_points=[tuple(pt) for pt in fin["shape_points"]],
            position=fin["position"],
            cant_angle=fin["cant_angle"],
            name=fin["name"],
        )

    for fin in trapezoidal_fins.values():
        rocket.add_trapezoidal_fins(
            n=fin["number"],
            root_chord=fin["root_chord"],
            tip_chord=fin["tip_chord"],
            span=fin["span"],
            position=fin["position"],
            cant_angle=fin.get("cant_angle", 0.0),
        )

    for fin in elliptical_fins.values():
        rocket.add_elliptical_fins(
            n=fin["number"],
            root_chord=fin["root_chord"],
            span=fin["span"],
            position=fin["position"],
            cant_angle=fin.get("cant_angle", 0.0),
        )

    if _is_empty(trapezoidal_fins) and _is_empty(elliptical_fins) and _is_empty(
        freeform_fins
    ):
        warnings.warn(
            "The export contains no fins: the rocket has no restoring moment, "
            "so stability and trajectory results are NOT physically "
            "representative.",
            stacklevel=2,
        )

    # Parachutes (indexed dict).
    for para in params.get("parachutes", {}).values():
        rocket.add_parachute(
            name=para["name"],
            cd_s=para["cds"],
            trigger=para["deploy_event"],
            lag=para["deploy_delay"],
        )

    # Rail buttons (single, flat dict, optional).
    rail_data = params.get("rail_buttons")
    if rail_data and not _is_empty(rail_data):
        rocket.set_rail_buttons(
            upper_button_position=rail_data["upper_position"],
            lower_button_position=rail_data["lower_position"],
            angular_position=rail_data["angular_position"],
        )

    return rocket


def build_nominal_flight(
    export_dir: str | os.PathLike,
    scenario: "Scenario | None" = None,
) -> tuple[Flight, Rocket, SolidMotor, Environment, dict]:
    """Build all nominal rocketpy objects from an export dir and optional scenario.

    This is the single source of truth for export→objects construction.
    Monte Carlo and comparison use-cases call this instead of duplicating
    the build logic.

    Rail overrides from ``scenario.rail`` are applied before constructing
    :class:`Flight` (REQ-SIM-04). The export's ``parameters.json`` is NOT
    mutated.

    Parameters
    ----------
    export_dir : str or Path
        RocketSerializer export directory.
    scenario : Scenario or None
        When provided, overrides site/atmosphere/rail fields.

    Returns
    -------
    tuple[Flight, Rocket, SolidMotor, Environment, dict]
        The five objects plus the raw ``params`` dict for downstream use
        (e.g. stochastic wrappers that need nominal values).
    """
    export_dir = Path(export_dir)
    with open(export_dir / "parameters.json", "r") as f:
        params = json.load(f)

    env = build_environment(params["environment"], scenario)
    motor = _build_motor(params["motors"], export_dir)
    rocket = _build_rocket(params, motor, export_dir)

    flight_data = params["flight"]

    # Apply rail overrides from scenario (REQ-SIM-04).
    rail_length = flight_data["rail_length"]
    inclination = flight_data["inclination"]
    heading = flight_data["heading"]

    if scenario is not None and scenario.rail is not None:
        if scenario.rail.length is not None:
            rail_length = scenario.rail.length
        if scenario.rail.inclination is not None:
            inclination = scenario.rail.inclination
        if scenario.rail.heading is not None:
            heading = scenario.rail.heading

    flight = Flight(
        rocket=rocket,
        environment=env,
        rail_length=rail_length,
        inclination=inclination,
        heading=heading,
        verbose=True,
    )

    return flight, rocket, motor, env, params


def simulate_from_export(
    export_dir: str | os.PathLike,
    scenario: "Scenario | None" = None,
) -> Flight:
    """Build and solve a RocketPy flight from a RocketSerializer export.

    ``export_dir`` must contain ``parameters.json``, ``thrust_source.csv`` and
    ``drag_curve.csv`` as produced by rocketserializer.

    Parameters
    ----------
    export_dir : str or Path
        RocketSerializer export directory.
    scenario : Scenario or None
        Optional scenario for site/atmosphere/rail overrides. When ``None``
        the existing standard-atmosphere behavior is preserved
        (REQ-XC-05 backward compatibility).

    Returns
    -------
    rocketpy.Flight
        The solved flight. Inspecting, printing or serializing it is the
        caller's responsibility.
    """
    flight, *_ = build_nominal_flight(export_dir, scenario)
    return flight
