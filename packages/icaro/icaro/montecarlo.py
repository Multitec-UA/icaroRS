"""Monte Carlo dispersion use-case (issue #2).

Runs many stochastic flights that vary the launch inputs within a scenario's
``uncertainty`` budget and returns the apogee distribution plus the landing
(and apogee) dispersion ellipses.

The nominal objects come from :func:`icaro.simulation.build_nominal_flight`;
this module only wraps them in RocketPy's stochastic models and drives
:class:`rocketpy.MonteCarlo`. It returns data and writes the output files; it
never prints. Advisories go through :func:`warnings.warn`.

Output contract (``prefix`` = ``output_prefix``)
-----------------------------------------------
``{prefix}.inputs.txt``   one JSON object per successful flight (sampled inputs)
``{prefix}.outputs.txt``  one JSON object per successful flight (results)
``{prefix}.errors.txt``   one JSON object per failed flight (inputs + ``error``)
``{prefix}.kml``          landing + apogee ellipses (only with enough samples)
"""

from __future__ import annotations

import copy
import json
import os
import threading
import warnings
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

import numpy as np
from rocketpy import (
    EllipticalFins,
    MonteCarlo,
    NoseCone,
    StochasticEnvironment,
    StochasticFlight,
    StochasticEllipticalFins,
    StochasticNoseCone,
    StochasticRocket,
    StochasticSolidMotor,
    StochasticTail,
    StochasticTrapezoidalFins,
    Tail,
    TrapezoidalFins,
)
from rocketpy.stochastic import StochasticModel, StochasticRailButtons
from rocketpy.tools import (
    generate_monte_carlo_ellipses,
    generate_monte_carlo_ellipses_coordinates,
)

from .scenario import DEFAULT_UNCERTAINTY, Dispersion
from .simulation import build_nominal_flight

if TYPE_CHECKING:
    from rocketpy import Environment

    from .scenario import Scenario

#: Uncertainty keys a scenario may disperse.
ALLOWED_UNCERTAINTY_KEYS: tuple[str, ...] = tuple(DEFAULT_UNCERTAINTY)

#: The single icaro advisory that replaces RocketPy's "under testing" warning.
MONTE_CARLO_WARNING = (
    "Monte Carlo dispersion runs on RocketPy's MonteCarlo engine, which "
    "RocketPy still flags as experimental; treat the results as preliminary."
)
_RAW_ROCKETPY_WARNING = r"This class is still under testing"

#: Fewer successful flights than this give no meaningful ellipse.
MIN_ELLIPSE_SAMPLES = 3

#: Ellipse confidence levels, in standard deviations (1σ, 2σ, 3σ).
ELLIPSE_SIGMAS: tuple[int, ...] = (1, 2, 3)

_ELLIPSE_RESOLUTION = 100
_PROGRESS_POLL_S = 0.25

#: ``rocketpy.MonteCarlo`` derives its files with ``Path.with_suffix``, which
#: would eat a dotted prefix ("run.v1" → "run.inputs.txt"). A throwaway suffix
#: keeps the whole prefix intact; no file with it is ever written.
_RAW_FILENAME_SUFFIX = ".mc"


# ---------------------------------------------------------------------------
# Stochastic models (S2)
# ---------------------------------------------------------------------------


@dataclass
class StochasticModels:
    """RocketPy stochastic models built from an export + uncertainty budget."""

    environment: StochasticEnvironment
    rocket: StochasticRocket
    motor: StochasticSolidMotor
    flight: StochasticFlight
    nominal_environment: "Environment"
    uncertainty: dict[str, Dispersion]


class _FixedSurface(StochasticModel):
    """Carries an aerodynamic surface into a StochasticRocket undispersed.

    RocketPy has no stochastic model for every surface type (e.g. free-form
    fins); without this the surface would silently vanish from the sampled
    rockets. Each sample gets its own copy of the nominal surface.
    """

    def __init__(self, component):
        super().__init__(component)

    def create_object(self):
        self.last_rnd_dict = {"name": getattr(self.obj, "name", None)}
        return copy.deepcopy(self.obj)


def _std(uncertainty: dict[str, Dispersion], key: str, nominal: float) -> float | None:
    """Map a scenario dispersion to the std RocketPy expects (``None`` = fixed)."""
    dispersion = uncertainty.get(key)
    if dispersion is None:
        return None
    if dispersion.kind == "relative":
        return dispersion.std * abs(nominal)
    return dispersion.std


def _resolve_uncertainty(scenario: "Scenario | None") -> dict[str, Dispersion]:
    if scenario is None or scenario.uncertainty is None:
        return dict(DEFAULT_UNCERTAINTY)
    unknown = sorted(set(scenario.uncertainty) - set(ALLOWED_UNCERTAINTY_KEYS))
    if unknown:
        raise ValueError(
            f"Unknown uncertainty key(s): {', '.join(unknown)}. "
            f"Allowed keys: {', '.join(ALLOWED_UNCERTAINTY_KEYS)}."
        )
    return dict(scenario.uncertainty)


def _fixed_position(position) -> list[float]:
    """Axial nominal position (``Vector.z`` or a number) as a fixed choice."""
    return [float(getattr(position, "z", position))]


def _add_surfaces(stochastic_rocket: StochasticRocket, rocket) -> None:
    """Copy the nominal rocket's components into the stochastic rocket.

    Surfaces are wrapped here rather than by ``StochasticRocket.add_*``:
    RocketPy's own wrapping passes ``component=`` to constructors that do not
    accept it. Nominal positions are passed as one-item lists (fixed): the
    rocket stores them as ``Vector`` objects, which the stochastic sampler
    cannot add to a float.
    """
    adders = (
        (NoseCone, StochasticNoseCone, stochastic_rocket.add_nose),
        (
            TrapezoidalFins,
            StochasticTrapezoidalFins,
            stochastic_rocket.add_trapezoidal_fins,
        ),
        (EllipticalFins, StochasticEllipticalFins, stochastic_rocket.add_elliptical_fins),
        (Tail, StochasticTail, stochastic_rocket.add_tail),
    )
    for surface, position in rocket.aerodynamic_surfaces:
        for surface_type, stochastic_type, add in adders:
            if type(surface) is surface_type:
                add(stochastic_type(surface), _fixed_position(position))
                break
        else:
            stochastic_rocket._add_surfaces(  # pylint: disable=protected-access
                _FixedSurface(surface),
                _fixed_position(position),
                type(surface),
                _FixedSurface,
                f"cannot carry {type(surface).__name__} into Monte Carlo",
            )
    for parachute in rocket.parachutes:
        stochastic_rocket.add_parachute(parachute)
    for rail_buttons, position in rocket.rail_buttons:
        stochastic_rocket.set_rail_buttons(
            StochasticRailButtons(rail_buttons), _fixed_position(position)
        )


def build_stochastic(
    export_dir: str | os.PathLike,
    scenario: "Scenario | None" = None,
) -> StochasticModels:
    """Build the RocketPy stochastic models for a Monte Carlo run.

    The nominal objects come from :func:`build_nominal_flight` (site,
    atmosphere and rail overrides included). The scenario's ``uncertainty``
    budget is mapped onto them:

    ==============  ===============================================
    key             stochastic parameter
    ==============  ===============================================
    ``mass``        ``StochasticRocket.mass``
    ``thrust``      ``StochasticSolidMotor.total_impulse``
    ``inclination`` ``StochasticFlight.inclination`` (degrees)
    ``heading``     ``StochasticFlight.heading`` (degrees)
    ``rail_length`` ``StochasticFlight.rail_length``
    ``wind_factor`` ``StochasticEnvironment.wind_velocity_{x,y}_factor``
    ==============  ===============================================

    A ``relative`` std is a fraction of the nominal value; an ``absolute`` std
    is in the parameter's own unit. A scenario without an ``uncertainty``
    block (``None``) uses :data:`DEFAULT_UNCERTAINTY`; keys missing from a
    present block stay at their nominal value.

    Raises
    ------
    ValueError
        If the uncertainty block has a key outside
        :data:`ALLOWED_UNCERTAINTY_KEYS`.
    """
    uncertainty = _resolve_uncertainty(scenario)
    flight, rocket, motor, env, _params = build_nominal_flight(export_dir, scenario)

    wind_std = _std(uncertainty, "wind_factor", 1.0) or 0.0
    stochastic_env = StochasticEnvironment(
        environment=env,
        wind_velocity_x_factor=(1.0, wind_std),
        wind_velocity_y_factor=(1.0, wind_std),
    )
    stochastic_motor = StochasticSolidMotor(
        solid_motor=motor,
        total_impulse=_std(uncertainty, "thrust", motor.total_impulse),
    )
    stochastic_rocket = StochasticRocket(
        rocket=rocket,
        mass=_std(uncertainty, "mass", rocket.mass),
    )
    stochastic_rocket.add_motor(stochastic_motor)
    _add_surfaces(stochastic_rocket, rocket)
    stochastic_flight = StochasticFlight(
        flight=flight,
        rail_length=_std(uncertainty, "rail_length", flight.rail_length),
        inclination=_std(uncertainty, "inclination", flight.inclination),
        heading=_std(uncertainty, "heading", flight.heading),
    )
    return StochasticModels(
        environment=stochastic_env,
        rocket=stochastic_rocket,
        motor=stochastic_motor,
        flight=stochastic_flight,
        nominal_environment=env,
        uncertainty=uncertainty,
    )


# ---------------------------------------------------------------------------
# Result
# ---------------------------------------------------------------------------


@dataclass
class ApogeeStats:
    """Apogee distribution summary, metres above ground level."""

    mean: float
    std: float
    min: float
    max: float
    p5: float
    p50: float
    p95: float


@dataclass
class MonteCarloResult:
    """Outcome of :func:`run_monte_carlo`.

    Ellipse lists hold one polygon per entry of :data:`ELLIPSE_SIGMAS`
    (index 0 = 1σ), each a list of ``(latitude, longitude)`` points. They are
    empty, and ``kml_path`` is ``None``, when fewer than
    :data:`MIN_ELLIPSE_SAMPLES` flights succeeded.
    """

    n_requested: int
    n_succeeded: int
    n_failed: int
    apogee_agl: list[float]
    apogee_stats: ApogeeStats | None
    impact_x: list[float]
    impact_y: list[float]
    landing_ellipses: list[list[tuple[float, float]]]
    apogee_ellipses: list[list[tuple[float, float]]]
    origin_latitude: float
    origin_longitude: float
    inputs_path: Path
    outputs_path: Path
    errors_path: Path
    kml_path: Path | None
    raw: Any = field(default=None, repr=False, compare=False)

    def to_dict(self) -> dict:
        """JSON-serializable view of the result (``raw`` excluded)."""
        return {
            "n_requested": self.n_requested,
            "n_succeeded": self.n_succeeded,
            "n_failed": self.n_failed,
            "apogee_agl": list(self.apogee_agl),
            "apogee_stats": asdict(self.apogee_stats) if self.apogee_stats else None,
            "impact_x": list(self.impact_x),
            "impact_y": list(self.impact_y),
            "ellipse_sigmas": list(ELLIPSE_SIGMAS),
            "landing_ellipses": [[list(p) for p in e] for e in self.landing_ellipses],
            "apogee_ellipses": [[list(p) for p in e] for e in self.apogee_ellipses],
            "origin": {
                "latitude": self.origin_latitude,
                "longitude": self.origin_longitude,
            },
            "files": {
                "inputs": str(self.inputs_path),
                "outputs": str(self.outputs_path),
                "errors": str(self.errors_path),
                "kml": str(self.kml_path) if self.kml_path else None,
            },
        }


# ---------------------------------------------------------------------------
# Run (S3–S6)
# ---------------------------------------------------------------------------


def _count_lines(path: Path) -> int:
    try:
        with open(path, "rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def _read_ndjson(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


class _ProgressWatcher:
    """Polls the output files and reports ``(done, total)`` from a thread.

    ``rocketpy.MonteCarlo`` has no progress hook; every finished flight adds
    one line to ``.outputs.txt`` or ``.errors.txt``.
    """

    def __init__(self, paths, total, on_progress):
        self._paths = paths
        self._total = total
        self._on_progress = on_progress
        self._stop = threading.Event()
        self._last = -1
        self._thread = threading.Thread(target=self._run, daemon=True)

    def _poll(self):
        done = min(sum(_count_lines(p) for p in self._paths), self._total)
        if done > self._last:
            self._last = done
            self._on_progress(done, self._total)

    def _run(self):
        while not self._stop.wait(_PROGRESS_POLL_S):
            self._poll()

    def __enter__(self):
        self._thread.start()
        return self

    def __exit__(self, *exc):
        self._stop.set()
        self._thread.join()
        if exc[0] is None and self._last < self._total:
            # Always close with (total, total) so surfaces can finish a bar.
            self._last = self._total
            self._on_progress(self._total, self._total)
        return False


def _ellipses(xs, ys, apogee_xs, apogee_ys, lat, lon):
    impact, apogee = generate_monte_carlo_ellipses(
        apogee_x=np.asarray(apogee_xs),
        apogee_y=np.asarray(apogee_ys),
        impact_x=np.asarray(xs),
        impact_y=np.asarray(ys),
        n_apogee=list(ELLIPSE_SIGMAS),
        n_impact=list(ELLIPSE_SIGMAS),
    )

    def to_points(ellipses):
        coords = generate_monte_carlo_ellipses_coordinates(
            ellipses, lat, lon, resolution=_ELLIPSE_RESOLUTION
        )
        return [[(float(p[0]), float(p[1])) for p in poly] for poly in coords]

    return to_points(impact), to_points(apogee)


def _apogee_stats(values: list[float]) -> ApogeeStats | None:
    if not values:
        return None
    arr = np.asarray(values, dtype=float)
    p5, p50, p95 = np.percentile(arr, [5, 50, 95])
    return ApogeeStats(
        mean=float(arr.mean()),
        std=float(arr.std(ddof=1)) if arr.size > 1 else 0.0,
        min=float(arr.min()),
        max=float(arr.max()),
        p5=float(p5),
        p50=float(p50),
        p95=float(p95),
    )


def run_monte_carlo(
    export_dir: str | os.PathLike,
    scenario: "Scenario | None",
    n: int,
    output_prefix: str | os.PathLike,
    *,
    parallel: bool = False,
    workers: int | None = None,
    on_progress: Callable[[int, int], None] | None = None,
) -> MonteCarloResult:
    """Run ``n`` stochastic flights and summarise their dispersion.

    Parameters
    ----------
    export_dir : str or Path
        RocketSerializer export directory.
    scenario : Scenario or None
        Site/atmosphere/rail overrides and the uncertainty budget (see
        :func:`build_stochastic`).
    n : int
        Number of flights to attempt (>= 1). Failed flights count towards
        ``n``; they are logged to ``.errors.txt`` and the run continues.
    output_prefix : str or Path
        Path prefix of the output files (see the module docstring). Existing
        files with this prefix are replaced.
    parallel, workers
        Forwarded to ``rocketpy.MonteCarlo.simulate`` (``workers`` >= 2).
    on_progress : callable, optional
        ``on_progress(done, total)``, called from a watcher thread as flights
        finish and always last with ``(n, n)``.

    Returns
    -------
    MonteCarloResult
    """
    if isinstance(n, bool) or not isinstance(n, int) or n < 1:
        raise ValueError(f"n must be an integer >= 1, got {n!r}")

    prefix = Path(output_prefix)
    inputs_path = Path(f"{prefix}.inputs.txt")
    outputs_path = Path(f"{prefix}.outputs.txt")
    errors_path = Path(f"{prefix}.errors.txt")
    kml_path = Path(f"{prefix}.kml")
    # Stale files would be imported by MonteCarlo and skew the progress count.
    for path in (inputs_path, outputs_path, errors_path, kml_path):
        path.unlink(missing_ok=True)

    models = build_stochastic(export_dir, scenario)
    env = models.nominal_environment

    with warnings.catch_warnings():
        warnings.filterwarnings(
            "ignore", message=_RAW_ROCKETPY_WARNING, category=UserWarning
        )
        mc = MonteCarlo(
            filename=Path(f"{prefix}{_RAW_FILENAME_SUFFIX}"),
            environment=models.environment,
            rocket=models.rocket,
            flight=models.flight,
        )
    warnings.warn(MONTE_CARLO_WARNING, UserWarning, stacklevel=2)

    def simulate():
        mc.simulate(
            number_of_simulations=n,
            parallel=parallel,
            n_workers=workers,
            skip_failed_simulations=True,
            # Curves (drag, thrust, gravity) are identical across flights and
            # would make every input line megabytes long.
            include_function_data=False,
        )

    if on_progress is None:
        simulate()
    else:
        with _ProgressWatcher((outputs_path, errors_path), n, on_progress):
            simulate()

    outputs = _read_ndjson(outputs_path)
    n_failed = _count_lines(errors_path)
    elevation = float(env.elevation)
    apogee_agl = [float(o["apogee"]) - elevation for o in outputs]
    impact_x = [float(o["x_impact"]) for o in outputs]
    impact_y = [float(o["y_impact"]) for o in outputs]
    lat, lon = float(env.latitude), float(env.longitude)

    landing_ellipses: list = []
    apogee_ellipses: list = []
    written_kml: Path | None = None
    if len(outputs) >= MIN_ELLIPSE_SAMPLES:
        landing_ellipses, apogee_ellipses = _ellipses(
            impact_x,
            impact_y,
            [float(o["apogee_x"]) for o in outputs],
            [float(o["apogee_y"]) for o in outputs],
            lat,
            lon,
        )
        mc.export_ellipses_to_kml(
            filename=str(kml_path),
            origin_lat=lat,
            origin_lon=lon,
            type="all",
            resolution=_ELLIPSE_RESOLUTION,
        )
        written_kml = kml_path
    elif outputs:
        warnings.warn(
            f"Only {len(outputs)} of {n} Monte Carlo flights succeeded; at least "
            f"{MIN_ELLIPSE_SAMPLES} are needed for dispersion ellipses, so none "
            "were produced.",
            UserWarning,
            stacklevel=2,
        )

    return MonteCarloResult(
        n_requested=n,
        n_succeeded=len(outputs),
        n_failed=n_failed,
        apogee_agl=apogee_agl,
        apogee_stats=_apogee_stats(apogee_agl),
        impact_x=impact_x,
        impact_y=impact_y,
        landing_ellipses=landing_ellipses,
        apogee_ellipses=apogee_ellipses,
        origin_latitude=lat,
        origin_longitude=lon,
        inputs_path=inputs_path,
        outputs_path=outputs_path,
        errors_path=errors_path,
        kml_path=written_kml,
        raw=mc,
    )
