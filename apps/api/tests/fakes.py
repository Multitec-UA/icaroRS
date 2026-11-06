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


class _Fn:
    """Minimal callable double for a rocketpy ``Function`` (callable at any t).

    Mirrors how flight quantities (altitude, speed, …) are callable Functions
    of time — so ``extract_flight_series`` can resample them via ``fn(t)``.
    """

    def __init__(self, f) -> None:
        self._f = f

    def __call__(self, t):
        return self._f(t)


class FakeFlight:
    """Minimal stub for ``rocketpy.Flight`` for use in serialize_flight tests.

    All scalar attributes are set to known floats.  The ``plots`` attribute
    exposes ``_FakePlots`` methods that write a tiny PNG when called with
    ``filename=``.  The time-series quantities (``altitude``, ``speed``,
    ``mach_number``, ``acceleration``, ``x``, ``y``) are callable Functions of
    time so ``extract_flight_series`` can resample them (issue #11).

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

        # --- Time-series (callable Functions of time), issue #11 ---
        self.altitude: _Fn = _Fn(lambda t: 30.0 * t)  # AGL, starts at 0
        self.speed: _Fn = _Fn(lambda t: 25.0)
        self.mach_number: _Fn = _Fn(lambda t: 0.05 * t)
        self.acceleration: _Fn = _Fn(lambda t: 9.81)
        self.x: _Fn = _Fn(lambda t: 1.5 * t)  # East
        self.y: _Fn = _Fn(lambda t: 2.0 * t)  # North

        # --- Plots stub ---
        self.plots: _FakePlots = _FakePlots()


# ---------------------------------------------------------------------------
# Monte Carlo doubles
# ---------------------------------------------------------------------------


def make_montecarlo_record(
    run_id: str = "mc-1",
    *,
    org_id: str = "test-org",
    rocket_id: str = "rk-1",
    export_id: str = "exp-1",
    status: str = "queued",
    n: int = 10,
    created_at=None,
    result: dict | None = None,
    result_prefix: str | None = None,
):
    """Build a ``MonteCarloRecord`` with sensible defaults for unit tests."""
    from datetime import datetime, timezone

    from icaro_api.services.db import MonteCarloRecord

    return MonteCarloRecord(
        run_id=run_id,
        rocket_id=rocket_id,
        export_id=export_id,
        org_id=org_id,
        created_by="test",
        created_at=created_at or datetime(2026, 1, 1, tzinfo=timezone.utc),
        scenario={"site": {"latitude": 0.0, "longitude": 0.0}},
        n=n,
        status=status,
        progress_done=0,
        progress_total=n,
        result=result,
        result_prefix=result_prefix,
    )


def fake_montecarlo_result(kml: str | None = "/tmp/x/montecarlo.kml") -> dict:
    """A ``MonteCarloResult.to_dict()``-shaped payload (nested ellipse arrays)."""
    return {
        "n_requested": 10,
        "n_succeeded": 10,
        "n_failed": 0,
        "apogee_agl": [800.0, 810.0],
        "apogee_stats": {
            "mean": 805.0, "std": 5.0, "min": 800.0, "max": 810.0,
            "p5": 800.5, "p50": 805.0, "p95": 809.5,
        },
        "impact_x": [1.0, 2.0],
        "impact_y": [3.0, 4.0],
        "ellipse_sigmas": [1, 2, 3],
        "landing_ellipses": [[[38.1, -0.5], [38.2, -0.6]]],
        "apogee_ellipses": [[[38.1, -0.5], [38.2, -0.6]]],
        "origin": {"latitude": 38.0, "longitude": -0.5},
        "files": {
            "inputs": "/tmp/x/montecarlo.inputs.txt",
            "outputs": "/tmp/x/montecarlo.outputs.txt",
            "errors": "/tmp/x/montecarlo.errors.txt",
            "kml": kml,
        },
    }


class FakeMonteCarloProcess:
    """Popen-like double for the Monte Carlo worker subprocess.

    Reads the worker argv to find ``--output-prefix`` and ``--result-json``.
    Each ``poll()`` appends one line to ``{prefix}.outputs.txt`` (simulating a
    finished flight) until ``lines`` flights are written; the next poll writes
    the result JSON (exit 0) or the stderr text (non-zero exit) and returns the
    exit code.
    """

    def __init__(self, argv, stderr_file, *, lines=3, returncode=0, stderr=b"", result=None):
        import json as _json

        def _arg(flag):
            return argv[argv.index(flag) + 1]

        self.argv = list(argv)
        self._prefix = Path(_arg("--output-prefix"))
        self._result_json = Path(_arg("--result-json"))
        self._stderr_file = stderr_file
        self._remaining = lines
        self._rc = returncode
        self._stderr = stderr
        self._result = result if result is not None else fake_montecarlo_result(
            kml=str(self._prefix) + ".kml"
        )
        self._json = _json
        self.returncode = None
        self.killed = False

    def kill(self):
        self.killed = True
        self.returncode = -9

    def wait(self, timeout=None):
        return self.returncode

    def poll(self):
        if self.returncode is not None:
            return self.returncode
        if self._remaining > 0:
            with open(f"{self._prefix}.outputs.txt", "a", encoding="utf-8") as f:
                f.write('{"apogee": 1}\n')
            self._remaining -= 1
            return None
        if self._rc == 0:
            Path(f"{self._prefix}.kml").write_text("<kml/>", encoding="utf-8")
            self._result_json.write_text(self._json.dumps(self._result), encoding="utf-8")
        else:
            self._stderr_file.write(self._stderr)
            self._stderr_file.flush()
        self.returncode = self._rc
        return self.returncode

    def wait(self, timeout=None):
        while self.poll() is None:
            pass
        return self.returncode
