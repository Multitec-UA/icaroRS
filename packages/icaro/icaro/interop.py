"""Simulated vs real flight interop (contract ``mt-interop`` schema v1).

Ícaro and the MT1 flight-telemetry service exchange one compact, versioned
document per flight through a shared database. This module holds the domain
half of that exchange:

* :func:`interop_simulation_payload` turns a solved RocketPy ``Flight`` into the
  flight-derived part of an ``mt-interop/simulation@1`` document: launch
  ``site``, ``events``, ``stats`` and the uniform-grid ``series``.
* :func:`interop_simulation_from_series` builds the same shape, approximately,
  from what older runs stored (the 400-point chart series and the scalars), so
  runs that predate the interop payload can still be compared.
* :func:`compare_with_real_flight` compares such a payload with an
  ``mt-interop/real-flight@1`` document: aligned series on one time grid,
  per-event deltas, KPI deltas, RMSE over the common window and warnings.

Contract rules (shared by both documents): SI units; ``t`` in seconds with
``t = 0`` at liftoff (RocketPy's ``t = 0``); ``series`` is a map of flat number
arrays of equal length on a uniform grid; ``alt_m`` is the height above the
launch pad; ``acc_ms2`` is the magnitude of the specific force, what an
accelerometer measures (``|a_inertial - g|`` for the simulation); events are
``{id, t, label}`` with ``id`` in :data:`EVENT_IDS` (readers ignore unknown ids).

Pure domain logic: functions return plain data; database access, document ids,
tenancy and timestamps are the delivery layer's job.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from itertools import pairwise
from typing import Any

#: Schema string of the simulation documents Ícaro publishes.
INTEROP_SIMULATION_SCHEMA = "mt-interop/simulation@1"
#: Schema string of the real-flight documents the telemetry service publishes.
INTEROP_REAL_FLIGHT_SCHEMA = "mt-interop/real-flight@1"

#: Event ids of contract v1, in flight order. Any other id is ignored.
EVENT_IDS: tuple[str, ...] = (
    "liftoff",
    "rail_exit",
    "burnout",
    "apogee",
    "ejection",
    "deploy",
    "landing",
)

#: Most samples a published ``series`` may hold (contract v1).
MAX_SERIES_POINTS = 2000

#: The series the comparison overlays, in display order.
COMPARED_SERIES: tuple[str, ...] = ("alt_m", "vz_ms", "acc_ms2")

#: Distance between the simulated site and the real pad above which the
#: comparison warns that the two flights did not start from the same place.
SITE_DISTANCE_WARN_M = 1000.0

_EARTH_RADIUS_M = 6_371_008.8  # IUGG mean Earth radius
_EVENT_LABELS: dict[str, str] = {
    "liftoff": "Liftoff",
    "rail_exit": "Rail exit",
    "burnout": "Burnout",
    "apogee": "Apogee",
    "ejection": "Ejection",
    "deploy": "Deploy",
    "landing": "Landing",
}


class InteropSchemaError(ValueError):
    """An interop document does not follow the expected schema."""


# ---------------------------------------------------------------------------
# Simulation payload
# ---------------------------------------------------------------------------


def interop_simulation_payload(flight: Any, *, max_points: int = MAX_SERIES_POINTS) -> dict:
    """The flight-derived part of an ``mt-interop/simulation@1`` document.

    Parameters
    ----------
    flight : rocketpy.Flight
        A solved flight (``simulate_from_export``).
    max_points : int, default 2000
        Samples on the uniform time grid ``[0, t_final]`` (``2..2000``).

    Returns
    -------
    dict
        ``{"site", "events", "stats", "series"}``:

        * ``site``: ``{lat, lon, elev_m}`` of the launch environment, or ``None``.
        * ``events``: ``liftoff`` (0), ``rail_exit``, ``burnout``, ``apogee``,
          one ``deploy`` per parachute (trigger time plus its lag, labelled
          with the parachute's name) and ``landing``, sorted by time. An event
          whose time cannot be read, or falls outside the flight, is left out.
        * ``stats``: ``apogee_m`` (above the pad), ``apogee_t``, ``vmax_ms``,
          ``amax_ms2`` (peak specific force), ``flight_time_s``.
        * ``series``: ``t``, ``alt_m``, ``vz_ms``, ``speed_ms``, ``acc_ms2``,
          ``x_m`` (East), ``y_m`` (North). A series the flight cannot provide
          is left out; ``t`` and ``alt_m`` are always there.
    """
    if not 2 <= max_points <= MAX_SERIES_POINTS:
        raise ValueError(f"max_points must be between 2 and {MAX_SERIES_POINTS}")

    t_final = float(flight.t_final)
    if t_final <= 0:
        raise ValueError("The flight has no duration (t_final <= 0).")
    last = max_points - 1
    ts = [t_final * i / last for i in range(max_points)]

    series: dict[str, list[float]] = {"t": [_round(t, 4) for t in ts]}
    altitude = _sample(flight, "altitude", ts)
    if altitude is None:
        raise ValueError("The flight has no altitude series.")
    series["alt_m"] = [_round(v) for v in altitude]
    for out_key, attr in (("vz_ms", "vz"), ("speed_ms", "speed"), ("x_m", "x"), ("y_m", "y")):
        values = _sample(flight, attr, ts)
        if values is not None:
            series[out_key] = [_round(v) for v in values]
    specific_force = _specific_force(flight, ts)
    if specific_force is not None:
        series["acc_ms2"] = [_round(v) for v in specific_force]

    events = _simulation_events(flight, t_final)
    apogee_t = _attr_float(flight, "apogee_time")
    apogee_m = _apogee_agl(flight)
    if apogee_m is None:
        apogee_m = max(series["alt_m"])
    stats = {
        "apogee_m": _round(apogee_m),
        "apogee_t": _round(apogee_t, 4) if apogee_t is not None else None,
        "vmax_ms": _round_or_none(_attr_float(flight, "max_speed")),
        "amax_ms2": _round(max(specific_force)) if specific_force else None,
        "flight_time_s": _round(t_final, 4),
    }

    return {"site": _site(flight), "events": events, "stats": stats, "series": series}


def interop_simulation_from_series(
    series: Mapping[str, Any],
    scalars: Mapping[str, Any],
    *,
    site: Mapping[str, Any] | None = None,
) -> dict:
    """An approximate simulation payload from a run's stored chart data.

    For runs that predate :func:`interop_simulation_payload`: their stored
    series (``extract_flight_series``: ``t``, ``altitude``, ``speed``,
    ``path3d``) and scalars still describe the flight, but not everything the
    contract asks for. What is missing is derived or left out, and the payload
    says so with ``approximate: True``:

    * ``vz_ms`` is the time derivative of the altitude (central differences);
    * ``acc_ms2`` is absent: the stored acceleration is the inertial one, and
      the specific force cannot be recovered from its magnitude;
    * events are ``liftoff``, ``rail_exit``, ``apogee`` and ``landing`` (no
      ``burnout``, no ``deploy``), taken from the scalars.

    Parameters
    ----------
    series : mapping
        The run's ``series.json`` content.
    scalars : mapping
        The run's result scalars (``apogee_m``, ``apogee_time_s``, ...).
    site : mapping or None
        ``{lat, lon, elev_m}`` of the scenario, when known.

    Raises
    ------
    InteropSchemaError
        When the series has no usable ``t`` / ``altitude`` arrays.
    """
    ts = _float_list(series.get("t"))
    alt = _float_list(series.get("altitude"))
    if ts is None or alt is None or len(ts) < 2 or len(ts) != len(alt):
        raise InteropSchemaError("The stored series has no usable t / altitude arrays.")

    out: dict[str, list[float]] = {
        "t": [_round(t, 4) for t in ts],
        "alt_m": [_round(a) for a in alt],
        "vz_ms": [_round(v) for v in _derivative(ts, alt)],
    }
    speed = _float_list(series.get("speed"))
    if speed is not None and len(speed) == len(ts):
        out["speed_ms"] = [_round(v) for v in speed]
    path = series.get("path3d")
    if isinstance(path, list) and len(path) == len(ts):
        try:
            out["x_m"] = [_round(float(p[0])) for p in path]
            out["y_m"] = [_round(float(p[1])) for p in path]
        except (TypeError, ValueError, IndexError):
            pass

    t_final = _num(scalars.get("flight_time_s"))
    if t_final is None:
        t_final = ts[-1]
    events: list[dict] = [{"id": "liftoff", "t": 0.0, "label": _EVENT_LABELS["liftoff"]}]
    for event_id, key in (("rail_exit", "rail_departure_time_s"), ("apogee", "apogee_time_s")):
        t = _num(scalars.get(key))
        if t is not None and 0 <= t <= t_final:
            events.append({"id": event_id, "t": _round(t, 4), "label": _EVENT_LABELS[event_id]})
    events.append({"id": "landing", "t": _round(t_final, 4), "label": _EVENT_LABELS["landing"]})

    apogee_m = _num(scalars.get("apogee_m"))
    stats = {
        "apogee_m": _round(apogee_m if apogee_m is not None else max(alt)),
        "apogee_t": _round_or_none(_num(scalars.get("apogee_time_s")), 4),
        "vmax_ms": _round_or_none(_num(scalars.get("max_velocity_ms"))),
        "amax_ms2": None,
        "flight_time_s": _round(t_final, 4),
    }
    return {
        "site": _site_from_mapping(site),
        "events": events,
        "stats": stats,
        "series": out,
        "approximate": True,
    }


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EventDelta:
    """One event on both sides. Times in s; ``*_value`` in ``value_unit``.

    ``delta_t`` and ``delta_value`` are simulated minus real, ``None`` when a
    side lacks the event. The value is the altitude above the pad for
    ``apogee``, ``ejection`` and ``deploy``; ``None`` for the other events.
    """

    id: str
    label: str
    sim_t: float | None
    real_t: float | None
    delta_t: float | None
    sim_value: float | None = None
    real_value: float | None = None
    delta_value: float | None = None
    value_unit: str | None = None


@dataclass(frozen=True)
class KpiDelta:
    """One headline number on both sides; ``delta`` is simulated minus real.

    ``delta_pct`` is ``delta`` relative to the real value (``None`` when a
    side is missing or the real value is 0).
    """

    id: str
    unit: str
    sim: float | None
    real: float | None
    delta: float | None
    delta_pct: float | None


@dataclass(frozen=True)
class ComparisonWarning:
    """An advisory about how far the comparison can be trusted.

    ``code`` is stable (surfaces translate it); ``message`` is plain English;
    ``value`` carries the number the code refers to, when there is one.
    """

    code: str
    message: str
    value: float | None = None


@dataclass(frozen=True)
class FlightComparison:
    """Result of :func:`compare_with_real_flight`.

    Attributes
    ----------
    t : list[float]
        Common uniform time grid (s) spanning both flights.
    sim, real : dict[str, list[float | None]]
        ``alt_m``, ``vz_ms``, ``acc_ms2`` resampled on ``t`` (linear
        interpolation); ``None`` outside a side's own time range. A series a
        side does not have is absent from its dict.
    events : list[EventDelta]
        ``rail_exit``, ``burnout``, ``apogee``, ``ejection``, ``deploy``
        (paired in order when there are several) and ``landing``, when at
        least one side has them.
    kpis : list[KpiDelta]
        ``apogee_m``, ``apogee_t``, ``vmax_ms``, ``amax_ms2``, ``landing_t``.
    rmse : dict[str, float | None]
        Root-mean-square difference of ``alt_m``, ``vz_ms`` and ``acc_ms2``
        over the common window (``None`` when a side lacks the series).
    window : tuple[float, float] | None
        ``(t_start, t_end)`` where both flights have data; ``None`` when they
        do not overlap.
    warnings : list[ComparisonWarning]
    site_distance_m : float | None
        Distance from the simulated site to the real pad, when both are known.
    """

    t: list[float]
    sim: dict[str, list[float | None]]
    real: dict[str, list[float | None]]
    events: list[EventDelta]
    kpis: list[KpiDelta]
    rmse: dict[str, float | None]
    window: tuple[float, float] | None
    warnings: list[ComparisonWarning] = field(default_factory=list)
    site_distance_m: float | None = None

    def to_dict(self) -> dict:
        """JSON-serializable view (plain dicts, lists, floats, strings, None)."""
        return {
            "series": {"t": list(self.t), "sim": dict(self.sim), "real": dict(self.real)},
            "events": [asdict(e) for e in self.events],
            "kpis": [asdict(k) for k in self.kpis],
            "rmse": dict(self.rmse),
            "window": (
                {"t_start": self.window[0], "t_end": self.window[1]}
                if self.window is not None
                else None
            ),
            "warnings": [asdict(w) for w in self.warnings],
            "site_distance_m": self.site_distance_m,
        }


def compare_with_real_flight(
    sim_payload: Mapping[str, Any],
    real_doc: Mapping[str, Any],
    *,
    max_points: int = 1000,
) -> FlightComparison:
    """Compare a simulation payload with an ``mt-interop/real-flight@1`` document.

    Parameters
    ----------
    sim_payload : mapping
        An ``mt-interop/simulation@1`` document, or the part of it built by
        :func:`interop_simulation_payload` /
        :func:`interop_simulation_from_series` (``series``, ``events``,
        ``stats``, ``site``). When it carries a ``schema`` it must be the
        simulation schema.
    real_doc : mapping
        The real flight document as stored by the telemetry service.
    max_points : int, default 1000
        Upper bound on the common grid. The grid step is never finer than the
        coarser of the two inputs.

    Raises
    ------
    InteropSchemaError
        Wrong ``schema`` string, or a ``series`` without equal-length ``t`` /
        ``alt_m`` arrays of at least two samples.
    """
    if max_points < 2:
        raise ValueError("max_points must be >= 2")
    real_schema = real_doc.get("schema")
    if real_schema != INTEROP_REAL_FLIGHT_SCHEMA:
        raise InteropSchemaError(
            f"Expected a {INTEROP_REAL_FLIGHT_SCHEMA!r} document, got {real_schema!r}."
        )
    sim_schema = sim_payload.get("schema")
    if sim_schema is not None and sim_schema != INTEROP_SIMULATION_SCHEMA:
        raise InteropSchemaError(
            f"Expected a {INTEROP_SIMULATION_SCHEMA!r} payload, got {sim_schema!r}."
        )

    sim_series = _series_columns(sim_payload.get("series"), "simulation")
    real_series = _series_columns(real_doc.get("series"), "real flight")
    sim_events = _events(sim_payload.get("events"))
    real_events = _events(real_doc.get("events"))
    sim_stats = _stats(sim_payload.get("stats"))
    real_stats = _stats(real_doc.get("stats"))

    grid = _common_grid(sim_series["t"], real_series["t"], max_points)
    sim_on_grid = {k: _resample(sim_series["t"], v, grid) for k, v in sim_series.items() if k in COMPARED_SERIES}
    real_on_grid = {k: _resample(real_series["t"], v, grid) for k, v in real_series.items() if k in COMPARED_SERIES}

    window = _overlap(sim_series["t"], real_series["t"])
    rmse: dict[str, float | None] = {}
    for key in COMPARED_SERIES:
        if key in sim_on_grid and key in real_on_grid and window is not None:
            rmse[key] = _rmse(grid, sim_on_grid[key], real_on_grid[key], window)
        else:
            rmse[key] = None

    events = _event_deltas(sim_events, real_events, sim_series, real_series, sim_stats, real_stats)
    kpis = _kpis(sim_stats, real_stats, sim_events, real_events)

    site_distance = _site_distance(sim_payload.get("site"), real_doc.get("pad"))
    warnings = _warnings(
        sim_payload=sim_payload,
        sim_series=sim_series,
        real_series=real_series,
        sim_events=sim_events,
        real_events=real_events,
        sim_stats=sim_stats,
        window=window,
        site_distance=site_distance,
        has_pad=_site_from_mapping(real_doc.get("pad")) is not None,
    )

    return FlightComparison(
        t=[_round(t, 4) for t in grid],
        sim=sim_on_grid,
        real=real_on_grid,
        events=events,
        kpis=kpis,
        rmse=rmse,
        window=window,
        warnings=warnings,
        site_distance_m=_round_or_none(site_distance, 1),
    )


# ---------------------------------------------------------------------------
# Private helpers: simulation side
# ---------------------------------------------------------------------------


def _round(value: float, digits: int = 3) -> float:
    return round(float(value), digits)


def _round_or_none(value: float | None, digits: int = 3) -> float | None:
    return None if value is None else _round(value, digits)


def _attr_float(obj: Any, name: str) -> float | None:
    try:
        value = float(getattr(obj, name))
    except (AttributeError, TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _sample(flight: Any, attr: str, ts: Sequence[float]) -> list[float] | None:
    """``flight.<attr>`` at each ``t``, or ``None`` when the flight cannot give it.

    A RocketPy ``Function`` built from solver output keeps its samples in
    ``source`` (an ``(n, 2)`` array); those are interpolated linearly. Calling
    the ``Function`` would use its spline, which rings across the
    discontinuities of a flight (a parachute opening makes ``az`` overshoot by
    an order of magnitude between two solver nodes). Anything else is called.
    """
    fn = getattr(flight, attr, None)
    if fn is None:
        return None
    try:
        values = _linear_from_source(fn, ts)
        if values is None:
            values = [float(fn(t)) for t in ts]
    except Exception:  # noqa: BLE001 - a series the flight cannot give is left out
        return None
    return values if all(math.isfinite(v) for v in values) else None


def _linear_from_source(fn: Any, ts: Sequence[float]) -> list[float] | None:
    source = getattr(fn, "source", None)
    shape = getattr(source, "shape", None)
    if shape is None or len(shape) != 2 or shape[1] != 2 or shape[0] < 2:
        return None
    import numpy as np

    return [float(v) for v in np.interp(ts, source[:, 0], source[:, 1])]


def _specific_force(flight: Any, ts: Sequence[float]) -> list[float] | None:
    """``|a_inertial - g|`` at each ``t``: what an on-board accelerometer reads.

    RocketPy's ``ax``, ``ay``, ``az`` are the inertial acceleration (ENU) with
    gravity included, so the specific force is ``(ax, ay, az + g(z))``, with
    the environment's gravity at the rocket's height above sea level.
    """
    ax = _sample(flight, "ax", ts)
    ay = _sample(flight, "ay", ts)
    az = _sample(flight, "az", ts)
    if ax is None or ay is None or az is None:
        return None
    gravity = _gravity_at(flight, ts)
    if gravity is None:
        return None
    return [math.sqrt(x * x + y * y + (z + g) ** 2) for x, y, z, g in zip(ax, ay, az, gravity)]


def _gravity_at(flight: Any, ts: Sequence[float]) -> list[float] | None:
    env = getattr(flight, "env", None)
    gravity = getattr(env, "gravity", None)
    if gravity is None:
        return None
    heights = _sample(flight, "z", ts)
    if heights is None:
        return None
    try:
        values = [float(gravity(h)) for h in heights]
    except Exception:  # noqa: BLE001
        return None
    return values if all(math.isfinite(v) for v in values) else None


def _apogee_agl(flight: Any) -> float | None:
    """RocketPy's ``apogee`` is above sea level; the contract wants above the pad."""
    apogee = _attr_float(flight, "apogee")
    elevation = _attr_float(getattr(flight, "env", None), "elevation")
    if apogee is None or elevation is None:
        return None
    return apogee - elevation


def _site(flight: Any) -> dict | None:
    env = getattr(flight, "env", None)
    lat = _attr_float(env, "latitude")
    lon = _attr_float(env, "longitude")
    if lat is None or lon is None:
        return None
    return {"lat": lat, "lon": lon, "elev_m": _attr_float(env, "elevation")}


def _simulation_events(flight: Any, t_final: float) -> list[dict]:
    events: list[dict] = [{"id": "liftoff", "t": 0.0, "label": _EVENT_LABELS["liftoff"]}]

    def add(event_id: str, t: float | None, label: str | None = None) -> None:
        if t is None or not 0 <= t <= t_final:
            return
        events.append({"id": event_id, "t": _round(t, 4), "label": label or _EVENT_LABELS[event_id]})

    add("rail_exit", _attr_float(flight, "out_of_rail_time"))
    motor = getattr(getattr(flight, "rocket", None), "motor", None)
    add("burnout", _attr_float(motor, "burn_out_time"))
    add("apogee", _attr_float(flight, "apogee_time"))
    for trigger_t, parachute in getattr(flight, "parachute_events", None) or []:
        lag = _attr_float(parachute, "lag") or 0.0
        name = getattr(parachute, "name", None)
        label = f"{_EVENT_LABELS['deploy']}: {name}" if name else _EVENT_LABELS["deploy"]
        try:
            add("deploy", float(trigger_t) + lag, label)
        except (TypeError, ValueError):
            continue
    add("landing", t_final)
    events.sort(key=lambda e: (e["t"], EVENT_IDS.index(e["id"])))
    return events


def _float_list(value: Any) -> list[float] | None:
    if not isinstance(value, (list, tuple)):
        return None
    try:
        out = [float(v) for v in value]
    except (TypeError, ValueError):
        return None
    return out if all(math.isfinite(v) for v in out) else None


def _derivative(ts: Sequence[float], ys: Sequence[float]) -> list[float]:
    """Central differences (one-sided at both ends)."""
    n = len(ts)
    out: list[float] = []
    for i in range(n):
        lo = max(i - 1, 0)
        hi = min(i + 1, n - 1)
        dt = ts[hi] - ts[lo]
        out.append((ys[hi] - ys[lo]) / dt if dt > 0 else 0.0)
    return out


# ---------------------------------------------------------------------------
# Private helpers: comparison
# ---------------------------------------------------------------------------


def _num(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if math.isfinite(out) else None


def _series_columns(series: Any, side: str) -> dict[str, list[float | None]]:
    """``t`` plus every equal-length numeric column; ``t``/``alt_m`` required."""
    if not isinstance(series, Mapping):
        raise InteropSchemaError(f"The {side} document has no series.")
    t = _float_list(series.get("t"))
    if t is None or len(t) < 2:
        raise InteropSchemaError(f"The {side} series has no usable 't' array.")
    if any(b < a for a, b in pairwise(t)):
        raise InteropSchemaError(f"The {side} series 't' is not sorted.")
    columns: dict[str, list[float | None]] = {"t": list(t)}
    for key, values in series.items():
        if key == "t" or not isinstance(values, (list, tuple)) or len(values) != len(t):
            continue
        columns[key] = [_num(v) for v in values]
    if "alt_m" not in columns:
        raise InteropSchemaError(f"The {side} series has no 'alt_m' array as long as 't'.")
    return columns


def _events(raw: Any) -> list[dict]:
    """Known-id events with a numeric ``t``, sorted by time."""
    if not isinstance(raw, (list, tuple)):
        return []
    out: list[dict] = []
    for item in raw:
        if not isinstance(item, Mapping) or item.get("id") not in EVENT_IDS:
            continue
        t = _num(item.get("t"))
        if t is None:
            continue
        label = item.get("label")
        out.append(
            {
                "id": item["id"],
                "t": t,
                "label": label if isinstance(label, str) and label else _EVENT_LABELS[item["id"]],
            }
        )
    out.sort(key=lambda e: e["t"])
    return out


def _stats(raw: Any) -> dict[str, float | None]:
    if not isinstance(raw, Mapping):
        return {}
    return {str(k): _num(v) for k, v in raw.items()}


def _median_step(ts: Sequence[float]) -> float:
    steps = sorted(b - a for a, b in pairwise(ts) if b > a)
    return steps[len(steps) // 2] if steps else 0.0


def _common_grid(sim_t: Sequence[float], real_t: Sequence[float], max_points: int) -> list[float]:
    start = min(sim_t[0], real_t[0])
    end = max(sim_t[-1], real_t[-1])
    span = end - start
    if span <= 0:
        return [start]
    step = max(_median_step(sim_t), _median_step(real_t), span / (max_points - 1))
    n = min(max_points, math.floor(span / step + 1e-9) + 1)
    n = max(n, 2)
    return [start + span * i / (n - 1) for i in range(n)]


def _resample(ts: Sequence[float | None], values: Sequence[float | None], grid: Iterable[float]) -> list[float | None]:
    """Linear interpolation on ``grid``; ``None`` outside ``ts`` or across gaps."""
    xs = [float(t) for t in ts if t is not None]
    out: list[float | None] = []
    n = len(xs)
    j = 0
    for g in grid:
        if g < xs[0] or g > xs[-1]:
            out.append(None)
            continue
        while j < n - 2 and xs[j + 1] < g:
            j += 1
        x0, x1 = xs[j], xs[j + 1]
        y0, y1 = values[j], values[j + 1]
        if y0 is None or y1 is None:
            out.append(y0 if g == x0 else (y1 if g == x1 else None))
            continue
        w = 0.0 if x1 == x0 else (g - x0) / (x1 - x0)
        out.append(_round(y0 + (y1 - y0) * w))
    return out


def _overlap(sim_t: Sequence[float], real_t: Sequence[float]) -> tuple[float, float] | None:
    start = max(sim_t[0], real_t[0], 0.0)
    end = min(sim_t[-1], real_t[-1])
    return (_round(start, 4), _round(end, 4)) if end > start else None


def _rmse(
    grid: Sequence[float],
    a: Sequence[float | None],
    b: Sequence[float | None],
    window: tuple[float, float],
) -> float | None:
    total = 0.0
    count = 0
    for t, x, y in zip(grid, a, b):
        if x is None or y is None or not window[0] <= t <= window[1]:
            continue
        total += (x - y) ** 2
        count += 1
    return _round(math.sqrt(total / count)) if count else None


def _interp_at(columns: Mapping[str, list[float | None]], key: str, t: float) -> float | None:
    if key not in columns:
        return None
    values = _resample(columns["t"], columns[key], [t])
    return values[0]


def _delta(a: float | None, b: float | None, digits: int = 3) -> float | None:
    return None if a is None or b is None else _round(a - b, digits)


def _event_deltas(
    sim_events: list[dict],
    real_events: list[dict],
    sim_series: Mapping[str, list[float | None]],
    real_series: Mapping[str, list[float | None]],
    sim_stats: Mapping[str, float | None],
    real_stats: Mapping[str, float | None],
) -> list[EventDelta]:
    out: list[EventDelta] = []
    for event_id in EVENT_IDS:
        if event_id == "liftoff":
            continue  # t = 0 on both sides by definition
        sims = [e for e in sim_events if e["id"] == event_id]
        reals = [e for e in real_events if e["id"] == event_id]
        for i in range(max(len(sims), len(reals))):
            sim_e = sims[i] if i < len(sims) else None
            real_e = reals[i] if i < len(reals) else None
            sim_t = sim_e["t"] if sim_e else None
            real_t = real_e["t"] if real_e else None
            label = (sim_e or real_e or {}).get("label") or _EVENT_LABELS[event_id]
            sim_value = real_value = None
            unit = None
            if event_id in ("apogee", "ejection", "deploy"):
                unit = "m"
                if event_id == "apogee":
                    sim_value = sim_stats.get("apogee_m")
                    real_value = real_stats.get("apogee_m")
                if sim_value is None and sim_t is not None:
                    sim_value = _interp_at(sim_series, "alt_m", sim_t)
                if real_value is None and real_t is not None:
                    real_value = _interp_at(real_series, "alt_m", real_t)
            out.append(
                EventDelta(
                    id=event_id,
                    label=label,
                    sim_t=_round_or_none(sim_t, 4),
                    real_t=_round_or_none(real_t, 4),
                    delta_t=_delta(sim_t, real_t, 4),
                    sim_value=_round_or_none(sim_value),
                    real_value=_round_or_none(real_value),
                    delta_value=_delta(sim_value, real_value),
                    value_unit=unit,
                )
            )
    return out


def _first_t(events: list[dict], event_id: str) -> float | None:
    return next((e["t"] for e in events if e["id"] == event_id), None)


def _kpis(
    sim_stats: Mapping[str, float | None],
    real_stats: Mapping[str, float | None],
    sim_events: list[dict],
    real_events: list[dict],
) -> list[KpiDelta]:
    sim_landing = sim_stats.get("flight_time_s")
    if sim_landing is None:
        sim_landing = _first_t(sim_events, "landing")
    real_landing = real_stats.get("landing_t")
    if real_landing is None:
        real_landing = _first_t(real_events, "landing")
    sim_apogee_t = sim_stats.get("apogee_t")
    if sim_apogee_t is None:
        sim_apogee_t = _first_t(sim_events, "apogee")
    real_apogee_t = real_stats.get("apogee_t")
    if real_apogee_t is None:
        real_apogee_t = _first_t(real_events, "apogee")

    rows = (
        ("apogee_m", "m", sim_stats.get("apogee_m"), real_stats.get("apogee_m")),
        ("apogee_t", "s", sim_apogee_t, real_apogee_t),
        ("vmax_ms", "m/s", sim_stats.get("vmax_ms"), real_stats.get("vmax_ms")),
        ("amax_ms2", "m/s²", sim_stats.get("amax_ms2"), real_stats.get("amax_ms2")),
        ("landing_t", "s", sim_landing, real_landing),
    )
    out: list[KpiDelta] = []
    for kpi_id, unit, sim, real in rows:
        delta = _delta(sim, real)
        pct = _round(delta / real * 100.0, 2) if delta is not None and real else None
        out.append(
            KpiDelta(
                id=kpi_id,
                unit=unit,
                sim=_round_or_none(sim),
                real=_round_or_none(real),
                delta=delta,
                delta_pct=pct,
            )
        )
    return out


def _site_from_mapping(raw: Any) -> dict | None:
    if not isinstance(raw, Mapping):
        return None
    lat = _num(raw.get("lat"))
    lon = _num(raw.get("lon"))
    if lat is None or lon is None:
        return None
    return {"lat": lat, "lon": lon, "elev_m": _num(raw.get("elev_m"))}


def _site_distance(sim_site: Any, real_pad: Any) -> float | None:
    """Great-circle distance (haversine, mean Earth radius) between two sites."""
    a = _site_from_mapping(sim_site)
    b = _site_from_mapping(real_pad)
    if a is None or b is None:
        return None
    lat1, lon1, lat2, lon2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def _warnings(
    *,
    sim_payload: Mapping[str, Any],
    sim_series: Mapping[str, list[float | None]],
    real_series: Mapping[str, list[float | None]],
    sim_events: list[dict],
    real_events: list[dict],
    sim_stats: Mapping[str, float | None],
    window: tuple[float, float] | None,
    site_distance: float | None,
    has_pad: bool,
) -> list[ComparisonWarning]:
    out: list[ComparisonWarning] = []
    if sim_payload.get("approximate"):
        out.append(
            ComparisonWarning(
                code="sim_approximate",
                message=(
                    "This run predates the interop payload: its vertical speed is derived "
                    "from the altitude and it has no accelerometer-equivalent series. Run the "
                    "simulation again for a full comparison."
                ),
            )
        )
    if site_distance is not None and site_distance > SITE_DISTANCE_WARN_M:
        out.append(
            ComparisonWarning(
                code="site_far",
                message=(
                    f"The simulated launch site is {site_distance / 1000:.1f} km from the real "
                    "pad: wind, elevation and atmosphere may differ."
                ),
                value=_round(site_distance, 1),
            )
        )
    elif site_distance is None and not has_pad:
        out.append(
            ComparisonWarning(
                code="pad_unknown",
                message="The real flight has no pad position: the launch sites cannot be checked.",
            )
        )
    sim_deploys = sum(1 for e in sim_events if e["id"] == "deploy")
    real_ids = {e["id"] for e in real_events}
    if sim_deploys == 1 and {"ejection", "deploy"} <= real_ids:
        out.append(
            ComparisonWarning(
                code="single_deploy",
                message=(
                    "The simulation has one parachute event (trigger plus delay) while the real "
                    "flight reports the ejection and the chute opening separately: the deploy "
                    "rows compare the chute opening."
                ),
            )
        )
    if window is None:
        out.append(
            ComparisonWarning(
                code="no_overlap",
                message="The simulated and real series do not overlap in time.",
            )
        )
    sim_apogee_t = sim_stats.get("apogee_t")
    real_end = real_series["t"][-1]
    if sim_apogee_t is not None and real_end is not None and real_end < sim_apogee_t:
        out.append(
            ComparisonWarning(
                code="real_ends_early",
                message=f"The real recording ends at {real_end:.1f} s, before the simulated apogee.",
                value=_round(real_end, 2),
            )
        )
    for key in COMPARED_SERIES:
        if key not in sim_series or key not in real_series:
            side = "simulation" if key not in sim_series else "real flight"
            out.append(
                ComparisonWarning(
                    code=f"missing_{key}",
                    message=f"The {side} has no '{key}' series: it is not compared.",
                )
            )
    return out
