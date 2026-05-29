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

from rocketpy import Environment, Flight, Rocket, SolidMotor


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


def _build_environment(env_data: dict) -> Environment:
    env = Environment(
        elevation=env_data["elevation"],
        latitude=env_data["latitude"],
        longitude=env_data["longitude"],
    )
    # Using the standard atmosphere model out of the box.
    env.set_atmospheric_model(type="standard_atmosphere")
    return env


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


def simulate_from_export(export_dir: str | os.PathLike) -> Flight:
    """Build and solve a RocketPy flight from a RocketSerializer export.

    ``export_dir`` must contain ``parameters.json``, ``thrust_source.csv`` and
    ``drag_curve.csv`` as produced by rocketserializer.

    Returns the solved :class:`rocketpy.Flight`. Inspecting, printing or
    serializing it is the caller's responsibility.
    """
    export_dir = Path(export_dir)
    with open(export_dir / "parameters.json", "r") as f:
        params = json.load(f)

    env = _build_environment(params["environment"])
    motor = _build_motor(params["motors"], export_dir)
    rocket = _build_rocket(params, motor, export_dir)

    flight_data = params["flight"]
    return Flight(
        rocket=rocket,
        environment=env,
        rail_length=flight_data["rail_length"],
        inclination=flight_data["inclination"],
        heading=flight_data["heading"],
        verbose=True,
    )
