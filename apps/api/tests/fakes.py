"""Fake/stub objects for icaro_api unit tests.

Provides ``FakeFlight`` — a minimal double for a ``rocketpy.Flight`` object
that exposes:

* All scalar attributes expected by ``serialize_flight`` (set to known floats).
* A ``plots`` inner object whose plot methods accept ``filename=`` and write a
  minimal 1x1 white PNG to the given path (so file-existence assertions pass).

No rocketpy is imported here — the stub is a pure Python object.

Usage
-----
>>> from tests.fakes import FakeFlight
>>> flight = FakeFlight()
>>> flight.apogee  # → 1423.5
>>> flight.plots.trajectory_3d(filename="/tmp/traj.png")  # writes a tiny PNG
"""

from __future__ import annotations

from pathlib import Path

# Minimal PNG bytes for a 1x1 white pixel image.
# Allows file-existence and non-empty-file checks to pass without PIL/numpy.
_TINY_PNG: bytes = (
    b"\x89PNG\r\n\x1a\n"  # PNG signature
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde"  # 1x1, 8-bit RGB
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _write_png(filename: str | Path | None) -> None:
    """Write a 1x1 white PNG to *filename* (noop if ``None``)."""
    if filename is None:
        return
    p = Path(filename)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(_TINY_PNG)


class _FakePlots:
    """Minimal stub for ``rocketpy.Flight.plots``.

    Every method that the real ``_FlightPlots`` exposes with ``filename=``
    is mirrored here.  Calling with ``filename=<path>`` writes a tiny PNG;
    calling without (or ``filename=None``) is a noop.

    Methods without ``filename=`` support in the real object (``pressure_signals``,
    ``all``) are intentionally omitted — the adapter must not call them.
    """

    def trajectory_3d(self, *, filename=None) -> None:
        _write_png(filename)

    def linear_kinematics_data(self, *, filename=None) -> None:
        _write_png(filename)

    def attitude_data(self, *, filename=None) -> None:
        _write_png(filename)

    def flight_path_angle_data(self, *, filename=None) -> None:
        _write_png(filename)

    def angular_kinematics_data(self, *, filename=None) -> None:
        _write_png(filename)

    def aerodynamic_forces(self, *, filename=None) -> None:
        _write_png(filename)

    def energy_data(self, *, filename=None) -> None:
        _write_png(filename)

    def fluid_mechanics_data(self, *, filename=None) -> None:
        _write_png(filename)

    def stability_and_control_data(self, *, filename=None) -> None:
        _write_png(filename)

    def pressure_rocket_altitude(self, *, filename=None) -> None:
        _write_png(filename)

    def rail_buttons_bending_moments(self, *, filename=None) -> None:
        _write_png(filename)

    def rail_buttons_forces(self, *, filename=None) -> None:
        _write_png(filename)


class FakeFlight:
    """Minimal stub for ``rocketpy.Flight`` for use in serialize_flight tests.

    All scalar attributes are set to known floats.  The ``plots`` attribute
    exposes ``_FakePlots`` methods that write a tiny PNG when called with
    ``filename=``.

    Attributes can be explicitly deleted to test the defensive getattr path
    (task 1.16 — missing attr must not crash serialize_flight).
    """

    def __init__(self) -> None:
        # --- Scalars expected by serialize_flight ---
        self.apogee: float = 1_423.5
        self.apogee_time: float = 12.3
        self.apogee_x: float = 42.1
        self.apogee_y: float = 17.8

        self.t_final: float = 45.6
        self.x_impact: float = 85.2
        self.y_impact: float = 31.4
        self.impact_velocity: float = -15.7

        self.max_speed: float = 342.1
        self.max_speed_time: float = 8.5
        self.max_mach_number: float = 1.002
        self.max_acceleration: float = 98.6
        self.max_acceleration_time: float = 0.3

        self.out_of_rail_velocity: float = 22.4
        self.out_of_rail_time: float = 0.8
        self.out_of_rail_stability_margin: float = 2.1

        # --- Plots stub ---
        self.plots: _FakePlots = _FakePlots()
