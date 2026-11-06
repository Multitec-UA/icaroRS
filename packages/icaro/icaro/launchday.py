"""Launch-day advisor: L1 checklist and rail (inclination/heading) recommendation.

Two use-cases for the team on the pad:

* :func:`launch_checks` turns one flight's numbers into the SURT x
  SpainRocketry L1 go/no-go checklist (:class:`LaunchLimits` holds the
  limits; Nov 2026 guide, rev. 5).
* :func:`recommend_rail` flies one deterministic flight per
  (inclination, heading) in a small grid, with the scenario's atmosphere (and
  manual wind, when given), and picks the setting that lands closest to the
  pad while passing every hard check.

PURE domain logic: returns dataclasses with numeric values only. Labels,
translations and colours are the delivery surfaces' job. RocketPy's progress
output is swallowed so callers never see it.
"""

from __future__ import annotations

import contextlib
import io
import math
import os
from dataclasses import asdict, dataclass, field
from typing import TYPE_CHECKING, Literal

from rocketpy import Flight

from icaro.simulation import build_nominal_flight

if TYPE_CHECKING:
    from icaro.scenario import Scenario

DEFAULT_INCLINATIONS: tuple[float, ...] = (90, 88, 86, 84, 82, 80)
DEFAULT_HEADINGS: tuple[float, ...] = tuple(range(0, 360, 30))
MAX_GRID_SIZE = 100
_MARGIN_SAMPLES = 20
_MODEL_WIND_HEIGHT_AGL = 10.0


# ---------------------------------------------------------------------------
# Limits and checks (S4)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LaunchLimits:
    """L1 competition limits (SURT x SpainRocketry L1 guide, Nov 2026, rev. 5).

    ``rail_exit_min_ms`` is common practice, NOT a requirement of the guide.
    """

    apogee_max_m: float = 1000  # hard, PROP-003
    apogee_recommended_max_m: float = 600  # soft, PROP-003 (simulations)
    tilt_max_deg: float = 20  # hard, PROP-003: inclination >= 70 deg
    static_margin_min_cal: float = 1.5  # hard, PROP-004, through the ascent
    descent_max_ms: float = 10  # hard, REC-003
    descent_recommended_ms: tuple[float, float] = (5, 6)  # soft, REC-003
    landing_radius_m: float = 500  # soft, REC-003 ("se recomienda")
    rail_exit_min_ms: float = 15  # soft, practice (not in the guide)
    wind_max_kmh: float = 32  # hard to go to the rail, Operativa 5.1

    def to_dict(self) -> dict:
        data = asdict(self)
        data["descent_recommended_ms"] = list(self.descent_recommended_ms)
        return data


@dataclass(frozen=True)
class LaunchCheck:
    """One checklist line. ``limit`` is ``[low, high]`` for ``between``."""

    id: str
    value: float
    limit: float | list[float]
    comparator: Literal["<=", ">=", "between"]
    ok: bool
    severity: Literal["hard", "soft"]
    source: str


@dataclass(frozen=True)
class RailCandidate:
    """One evaluated rail setting. Distances in m, speeds in m/s, angles in deg."""

    inclination: float
    heading: float
    apogee_agl: float
    landing_distance: float
    landing_bearing: float  # direction of the landing point, from north
    out_of_rail_velocity: float
    stability_margin_min: float  # calibres, rail exit → apogee
    impact_velocity: float  # positive
    checks_ok: bool  # every hard L1 check passes


def _check(id_, value, limit, comparator, severity, source) -> LaunchCheck:
    if comparator == "<=":
        ok = value <= limit
    elif comparator == ">=":
        ok = value >= limit
    else:
        low, high = limit
        ok = low <= value <= high
        limit = [low, high]
    return LaunchCheck(
        id=id_,
        value=float(value),
        limit=limit if isinstance(limit, list) else float(limit),
        comparator=comparator,
        ok=bool(ok),
        severity=severity,
        source=source,
    )


def launch_checks(
    candidate: RailCandidate,
    wind_speed_ms: float,
    limits: LaunchLimits = LaunchLimits(),
) -> list[LaunchCheck]:
    """The L1 checklist for one candidate and the wind on the pad.

    ``tilt_max`` reports the tilt from vertical (``90 - inclination``) and
    ``wind_max`` the wind in km/h, so each value shares its limit's unit.
    """
    c, lim = candidate, limits
    return [
        _check("apogee_max", c.apogee_agl, lim.apogee_max_m, "<=", "hard", "PROP-003"),
        _check(
            "apogee_recommended",
            c.apogee_agl,
            lim.apogee_recommended_max_m,
            "<=",
            "soft",
            "PROP-003",
        ),
        _check("tilt_max", 90 - c.inclination, lim.tilt_max_deg, "<=", "hard", "PROP-003"),
        _check(
            "static_margin_min",
            c.stability_margin_min,
            lim.static_margin_min_cal,
            ">=",
            "hard",
            "PROP-004",
        ),
        _check("descent_max", c.impact_velocity, lim.descent_max_ms, "<=", "hard", "REC-003"),
        _check(
            "descent_recommended",
            c.impact_velocity,
            lim.descent_recommended_ms,
            "between",
            "soft",
            "REC-003",
        ),
        _check("landing_radius", c.landing_distance, lim.landing_radius_m, "<=", "soft", "REC-003"),
        _check(
            "rail_exit_min", c.out_of_rail_velocity, lim.rail_exit_min_ms, ">=", "soft", "practice"
        ),
        _check("wind_max", wind_speed_ms * 3.6, lim.wind_max_kmh, "<=", "hard", "Operativa 5.1"),
    ]


# ---------------------------------------------------------------------------
# Rail recommendation (S3)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WindUsed:
    """The wind the sweep flew with: m/s and meteorological degrees (from)."""

    speed: float
    direction_from: float
    source: Literal["manual", "model"]


@dataclass(frozen=True)
class SkippedCandidate:
    inclination: float
    heading: float
    error: str


@dataclass
class RailSweep:
    """Result of :func:`recommend_rail`. ``candidates`` sorted by landing distance."""

    wind: WindUsed
    current: RailCandidate
    best: RailCandidate | None
    candidates: list[RailCandidate]
    skipped: list[SkippedCandidate]
    limits: LaunchLimits
    checks_current: list[LaunchCheck] = field(default_factory=list)
    checks_best: list[LaunchCheck] | None = None

    def to_dict(self) -> dict:
        """JSON-serializable view (plain dicts, lists, floats, strings)."""
        return {
            "wind": asdict(self.wind),
            "current": asdict(self.current),
            "best": asdict(self.best) if self.best is not None else None,
            "candidates": [asdict(c) for c in self.candidates],
            "skipped": [asdict(s) for s in self.skipped],
            "limits": self.limits.to_dict(),
            "checks_current": [asdict(c) for c in self.checks_current],
            "checks_best": (
                [asdict(c) for c in self.checks_best] if self.checks_best is not None else None
            ),
        }


def _wind_used(scenario: "Scenario | None", env) -> WindUsed:
    if scenario is not None and scenario.wind is not None:
        w = scenario.wind
        return WindUsed(float(w.speed), float(w.direction_from), "manual")
    height = env.elevation + _MODEL_WIND_HEIGHT_AGL
    u = float(env.wind_velocity_x(height))
    v = float(env.wind_velocity_y(height))
    speed = math.hypot(u, v)
    # The air moves along (u, v); it comes FROM the opposite direction.
    direction_from = math.degrees(math.atan2(-u, -v)) % 360 if speed > 1e-9 else 0.0
    return WindUsed(speed, direction_from, "model")


def _stability_margin_min(flight) -> float:
    start = getattr(flight, "out_of_rail_time", None) or 1e-3
    end = max(float(flight.apogee_time), start)
    step = (end - start) / (_MARGIN_SAMPLES - 1)
    return min(float(flight.stability_margin(start + i * step)) for i in range(_MARGIN_SAMPLES))


def _candidate(flight, env, inclination, heading, wind_speed_ms, limits) -> RailCandidate:
    x, y = float(flight.x_impact), float(flight.y_impact)
    candidate = RailCandidate(
        inclination=inclination,
        heading=heading,
        apogee_agl=float(flight.apogee) - float(env.elevation),
        landing_distance=math.hypot(x, y),
        landing_bearing=math.degrees(math.atan2(x, y)) % 360,
        out_of_rail_velocity=float(flight.out_of_rail_velocity),
        stability_margin_min=_stability_margin_min(flight),
        impact_velocity=abs(float(flight.impact_velocity)),
        checks_ok=False,
    )
    hard_ok = all(
        c.ok for c in launch_checks(candidate, wind_speed_ms, limits) if c.severity == "hard"
    )
    return RailCandidate(**{**asdict(candidate), "checks_ok": hard_ok})


def _rail_setting(scenario: "Scenario | None", params: dict) -> tuple[float, float, float]:
    """(rail_length, inclination, heading): scenario overrides, else the export."""
    flight_data = params["flight"]
    rail = scenario.rail if scenario is not None else None

    def pick(rail_field: str, export_key: str) -> float:
        value = getattr(rail, rail_field) if rail is not None else None
        return flight_data[export_key] if value is None else value

    return (
        pick("length", "rail_length"),
        pick("inclination", "inclination"),
        pick("heading", "heading"),
    )


def _validate_grid(inclinations, headings, limits: LaunchLimits) -> None:
    low = 90 - limits.tilt_max_deg
    for inc in inclinations:
        if not low <= inc <= 90:
            raise ValueError(
                f"Rail inclination {inc} deg is outside the allowed range "
                f"[{low:g}, 90] (L1 maximum tilt {limits.tilt_max_deg:g} deg)."
            )
    for hdg in headings:
        if not 0 <= hdg < 360:
            raise ValueError(f"Rail heading {hdg} deg must be within [0, 360).")
    size = len(inclinations) * len(headings)
    if size > MAX_GRID_SIZE:
        raise ValueError(
            f"The rail grid has {size} candidates; at most {MAX_GRID_SIZE} are allowed "
            f"({len(inclinations)} inclinations x {len(headings)} headings)."
        )


class _Nominal:
    """The scenario's objects built once and reused by every candidate flight."""

    def __init__(self, export_dir, scenario, limits):
        with contextlib.redirect_stdout(io.StringIO()):
            self.flight, self.rocket, _, self.env, params = build_nominal_flight(
                export_dir, scenario
            )
        self.rail_length, self.inclination, self.heading = _rail_setting(scenario, params)
        self.wind = _wind_used(scenario, self.env)
        self.limits = limits

    def current(self) -> RailCandidate:
        return _candidate(
            self.flight, self.env, self.inclination, self.heading, self.wind.speed, self.limits
        )

    def fly(self, inclination, heading) -> RailCandidate:
        with contextlib.redirect_stdout(io.StringIO()):
            flight = Flight(
                rocket=self.rocket,
                environment=self.env,
                rail_length=self.rail_length,
                inclination=inclination,
                heading=heading,
                verbose=False,
            )
            return _candidate(flight, self.env, inclination, heading, self.wind.speed, self.limits)


def evaluate_rail(
    export_dir: str | os.PathLike,
    scenario: "Scenario | None",
    inclination: float | None,
    heading: float | None,
    limits: LaunchLimits = LaunchLimits(),
) -> RailCandidate:
    """Fly one rail setting; ``None`` keeps the scenario's (or export's) value."""
    nominal = _Nominal(export_dir, scenario, limits)
    if inclination is None and heading is None:
        return nominal.current()
    return nominal.fly(
        nominal.inclination if inclination is None else inclination,
        nominal.heading if heading is None else heading,
    )


def recommend_rail(
    export_dir: str | os.PathLike,
    scenario: "Scenario | None",
    inclinations=DEFAULT_INCLINATIONS,
    headings=DEFAULT_HEADINGS,
    limits: LaunchLimits = LaunchLimits(),
) -> RailSweep:
    """Sweep (inclination, heading) and recommend the setting landing closest.

    The scenario's objects (atmosphere included, so a forecast is fetched once)
    are built once with :func:`~icaro.simulation.build_nominal_flight`; that
    flight is ``current``. Each grid point then flies a new ``Flight`` with the
    same rocket, environment and rail length. A candidate whose flight raises
    is reported in ``skipped``. ``best`` is the closest landing among the
    candidates passing every hard check, else the closest overall (its
    ``checks_ok`` is then ``False``), or ``None`` when every candidate failed.

    Raises:
        ValueError: an inclination outside ``[90 - tilt_max_deg, 90]``, a
            heading outside ``[0, 360)``, or more than 100 candidates.
    """
    inclinations, headings = list(inclinations), list(headings)
    _validate_grid(inclinations, headings, limits)

    nominal = _Nominal(export_dir, scenario, limits)
    current = nominal.current()

    candidates: list[RailCandidate] = []
    skipped: list[SkippedCandidate] = []
    for inc in inclinations:
        for hdg in headings:
            try:
                candidates.append(nominal.fly(inc, hdg))
            except Exception as exc:  # any solver failure skips this point only
                skipped.append(SkippedCandidate(inc, hdg, f"{type(exc).__name__}: {exc}"))

    candidates.sort(key=lambda c: c.landing_distance)
    passing = [c for c in candidates if c.checks_ok]
    best = (passing or candidates or [None])[0]

    return RailSweep(
        wind=nominal.wind,
        current=current,
        best=best,
        candidates=candidates,
        skipped=skipped,
        limits=limits,
        checks_current=launch_checks(current, nominal.wind.speed, limits),
        checks_best=launch_checks(best, nominal.wind.speed, limits) if best else None,
    )
