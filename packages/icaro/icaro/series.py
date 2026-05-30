"""Flight time-series extraction use-case (issue #11).

Pulls the numerical flight history out of a solved rocketpy ``Flight`` into
plain, JSON-safe Python lists, resampled onto a single uniform time grid so
every series shares one ``t`` axis and the payload stays small.

This is PURE domain logic: it reads domain data and returns plain values. It
does NOT format, serialize to a wire shape, or do any I/O — the delivery layer
(API/web) decides how to ship it. Mirrors the architecture rule in
``simulation.py``: a package returns data; it does not present it.

Why resample (instead of dumping ``Function.get_source()``)?
------------------------------------------------------------
Each rocketpy flight quantity is a callable ``Function`` defined on
``[0, t_final]``, but their native sample points (solver timesteps) differ per
series. Sampling every series at the same uniform grid via ``fn(t)`` yields
aligned arrays against one ``t`` axis — exactly the JSON shape the frontend
charts and the 3D trajectory need — and bounds the payload to ``max_points``.
"""

from __future__ import annotations

from typing import Any

# Output series name -> rocketpy Flight attribute (each a callable Function).
_SERIES_ATTRS: dict[str, str] = {
    "altitude": "altitude",  # above ground level (m), starts at 0
    "speed": "speed",  # m/s
    "mach": "mach_number",  # dimensionless
    "acceleration": "acceleration",  # m/s²
}


def extract_flight_series(flight: Any, *, max_points: int = 400) -> dict[str, list]:
    """Extract resampled flight time-series from a solved ``Flight``.

    Parameters
    ----------
    flight : rocketpy.Flight (or a callable-Function stub in tests)
        A solved flight whose quantities are callable Functions of time.
    max_points : int, default 400
        Number of samples on the uniform time grid (``>= 2``). Caps the
        payload size while staying smooth enough for charts.

    Returns
    -------
    dict
        ``{"t": [...], "altitude": [...], "speed": [...], "mach": [...],
           "acceleration": [...], "path3d": [[x, y, altitude], ...]}``

        * ``t`` spans ``[0, t_final]`` with ``max_points`` uniform samples.
        * Each named series is aligned to ``t``; a series whose attribute is
          missing or errors is omitted (never crashes — forward-compat with
          stubs / differing rocketpy configs).
        * ``path3d`` is (East, North, Up) = ``(x, y, altitude AGL)`` so the
          trajectory starts at the launch origin on the ground.
    """
    if max_points < 2:
        raise ValueError("max_points must be >= 2")

    t_final = float(flight.t_final)
    if t_final <= 0:
        ts = [0.0]
    else:
        last = max_points - 1
        ts = [t_final * i / last for i in range(max_points)]

    series: dict[str, list] = {"t": ts}

    for out_key, attr in _SERIES_ATTRS.items():
        fn = getattr(flight, attr, None)
        if fn is None:
            continue
        try:
            series[out_key] = [float(fn(t)) for t in ts]
        except Exception:  # noqa: BLE001 — a bad series is omitted, not fatal.
            continue

    # 3D trajectory: (East, North, Up) = (x, y, altitude AGL).
    x = getattr(flight, "x", None)
    y = getattr(flight, "y", None)
    alt = getattr(flight, "altitude", None)
    if x is not None and y is not None and alt is not None:
        try:
            series["path3d"] = [
                [float(x(t)), float(y(t)), float(alt(t))] for t in ts
            ]
        except Exception:  # noqa: BLE001
            pass

    return series
