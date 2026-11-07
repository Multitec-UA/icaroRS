"""Rail-exit stability margin with body lift — the OpenRocket-equivalent margin.

RocketPy's centre of pressure depends on Mach only: it sums the aerodynamic
surfaces' normal-force slopes (Barrowman). OpenRocket also adds the lift of
the body itself (nose cone, tubes, transitions) at the actual angle of attack
(Galejs), which moves the CP forward when the wind makes the rocket leave the
rail at an angle. This module computes that second margin for REPORTING only:
the trajectory is not changed.

Body lift per segment (OpenRocket ``SymmetricComponentCalc``, ``BODY_LIFT_K``)::

    CN_body = K * A_plan / A_ref * sin(a) * sinc(a)  = K * A_plan / A_ref * sin^2(a) / a

applied at the segment's planform centroid, with ``A_ref = pi * r_ref**2``.

Pure domain logic: returns objects, never prints (advisories go through
``warnings.warn``).
"""

from __future__ import annotations

import math
import warnings
from dataclasses import dataclass

from rocketpy.rocket.aero_surface.generic_surface import GenericSurface

BODY_LIFT_K = 1.1


@dataclass(frozen=True)
class WindMarginResult:
    """Rail-exit stability margins, in calibres, plus what produced them.

    ``static_cal`` is RocketPy's ``out_of_rail_stability_margin``;
    ``wind_cal`` adds body lift at the rail-exit angle of attack (equal to
    ``static_cal`` at zero angle). CPs are in the rocket's coordinate system.
    ``used_fallback`` is True when the body geometry was estimated because the
    export has no ``body_segments``.
    """

    static_cal: float
    wind_cal: float
    angle_of_attack_deg: float
    cp_static: float
    cp_wind: float
    used_fallback: bool


def _nose_planform(kind: str, length: float, fore: float, aft: float) -> tuple[float, float]:
    """(area, centroid from the front) of a nose cone's side silhouette.

    Exact for ``ellipsoid`` (half ellipse) and ``conical`` (triangle, via the
    trapezoid); other shapes use the trapezoid approximation.
    """
    if kind == "ellipsoid" and (fore == 0.0) != (aft == 0.0):
        # r(x) = R*sqrt(1 - (1 - x/L)^2): area = int 2r dx = pi*R*L/2,
        # centroid = L*(1 - 4/(3*pi)) from the tip (flipped: 4L/(3*pi)).
        base = max(fore, aft)
        offset = 4 * length / (3 * math.pi)
        return math.pi * base * length / 2, length - offset if fore == 0.0 else offset
    return _trapezoid(length, fore, aft)


def _trapezoid(length: float, fore: float, aft: float) -> tuple[float, float]:
    area = length * (fore + aft)
    if fore + aft == 0:
        return 0.0, length / 2
    return area, length * (fore + 2 * aft) / (3 * (fore + aft))


def _orientation_sign(params: dict) -> int:
    """+1 when rocket coordinates grow toward the tail (``nose_to_tail``)."""
    orientation = params["rocket"].get("coordinate_system_orientation", "nose_to_tail")
    return 1 if orientation == "nose_to_tail" else -1


def _fallback_segments(params: dict) -> list[tuple[str, float, float, float, float]]:
    """Nose cone + one tube of the rocket radius to the aft-most body point."""
    nose = params["nosecones"]
    sign = _orientation_sign(params)
    nose_pos = nose["position"]

    def from_tip(z: float) -> float:
        return sign * (z - nose_pos)

    ends = []
    for fin in params.get("trapezoidal_fins", {}).values():
        ends.append(from_tip(fin["position"]) + fin["root_chord"])
    for fin in params.get("elliptical_fins", {}).values():
        ends.append(from_tip(fin["position"]) + fin["root_chord"])
    for fin in params.get("freeform_fins", {}).values():
        ends.append(from_tip(fin["position"]) + max(p[0] for p in fin["shape_points"]))
    for tail in params.get("tails", {}).values():
        ends.append(from_tip(tail["position"]) + tail["length"])
    motor = params.get("motors") or {}
    if "position" in motor and "nozzle_position" in motor:
        motor_sign = (
            1
            if motor.get("coordinate_system_orientation", "nozzle_to_combustion_chamber")
            == "nozzle_to_combustion_chamber"
            else -1
        )
        # Same as rocketpy's Rocket.nozzle_position (rocket csys = -sign).
        nozzle_z = motor["position"] + motor["nozzle_position"] * (-sign) * motor_sign
        ends.append(from_tip(nozzle_z))

    radius = params["rocket"]["radius"]
    segments = [("nosecone", 0.0, nose["length"], 0.0, nose["base_radius"])]
    tube_end = max(ends, default=nose["length"])
    if tube_end > nose["length"]:
        segments.append(("bodytube", nose["length"], tube_end - nose["length"], radius, radius))
    return segments


def body_planform(params: dict) -> tuple[list[tuple[float, float]], bool]:
    """Planform of every body segment: ``([(area, centroid_from_tip), ...], used_fallback)``.

    Areas are side silhouettes (``int 2 r(x) dx``) in m^2; centroids are in
    metres from the nose tip. Uses ``params["body_segments"]`` when present;
    otherwise estimates the body (see :func:`_fallback_segments`) and warns.
    """
    nose = params.get("nosecones") or {}
    raw = params.get("body_segments")
    used_fallback = not raw or any(s.get("position") is None for s in raw)
    if used_fallback:
        warnings.warn(
            "The export has no usable 'body_segments' (converted before body "
            "geometry was exported): the wind stability margin estimates the "
            "body as the nose cone plus one tube of the rocket radius. "
            "Re-convert the .ork for the exact body.",
            UserWarning,
            stacklevel=2,
        )
        segments = _fallback_segments(params)
    else:
        segments = [
            (s["kind"], s["position"], s["length"], s["fore_radius"], s["aft_radius"])
            for s in raw
        ]

    planform = []
    for kind, front, length, fore, aft in segments:
        if kind == "nosecone":
            area, centroid = _nose_planform(nose.get("kind", ""), length, fore, aft)
        else:
            area, centroid = _trapezoid(length, fore, aft)
        planform.append((area, front + centroid))
    return planform, used_fallback


def _value(func, x) -> float:
    getter = getattr(func, "get_value_opt", None)
    return float(getter(x) if getter is not None else func(x))


def _surface_sums(rocket, mach: float) -> tuple[float, float]:
    """(sum CNa, sum CNa*x_cp) exactly as ``Rocket.evaluate_center_of_pressure``."""
    cna = moment = 0.0
    for surface, position in rocket.aerodynamic_surfaces:
        if isinstance(surface, GenericSurface):
            continue
        ref_factor = (surface.rocket_radius / rocket.radius) ** 2
        slope = ref_factor * _value(surface.clalpha, mach)
        cna += slope
        moment += slope * (position.z - rocket._csys * surface.cpz)
    return cna, moment


def wind_stability_margin(flight, rocket, params: dict, k: float = BODY_LIFT_K) -> WindMarginResult:
    """Rail-exit stability margin including body lift at the angle of attack.

    ``CP_wind = (sum CNa*x + sum CN_body*x_body) / (sum CNa + sum CN_body)`` at
    the rail-exit Mach and angle of attack; the margin shifts from RocketPy's
    ``out_of_rail_stability_margin`` by the CP displacement, so at zero angle
    of attack ``wind_cal == static_cal`` exactly.
    """
    t = flight.out_of_rail_time
    mach = _value(flight.mach_number, t)
    # Total angle of attack is >= 0 by definition; the spline can dip below.
    alpha_deg = max(_value(flight.angle_of_attack, t), 0.0)
    alpha = math.radians(alpha_deg)
    static_cal = float(flight.out_of_rail_stability_margin)

    cna, moment = _surface_sums(rocket, mach)
    cp_static = moment / cna

    planform, used_fallback = body_planform(params)
    weight_per_area = 0.0 if alpha == 0 else k / (math.pi * rocket.radius**2) * math.sin(alpha) ** 2 / alpha
    sign = _orientation_sign(params)
    nose_pos = params["nosecones"]["position"]
    body_cn = body_moment = 0.0
    for area, centroid in planform:
        weight = weight_per_area * area
        body_cn += weight
        body_moment += weight * (nose_pos + sign * centroid)

    if body_cn == 0.0:
        cp_wind = cp_static
        wind_cal = static_cal
    else:
        cp_wind = (moment + body_moment) / (cna + body_cn)
        wind_cal = static_cal + (cp_static - cp_wind) * rocket._csys / (2 * rocket.radius)

    return WindMarginResult(
        static_cal=static_cal,
        wind_cal=wind_cal,
        angle_of_attack_deg=alpha_deg,
        cp_static=cp_static,
        cp_wind=cp_wind,
        used_fallback=used_fallback,
    )
