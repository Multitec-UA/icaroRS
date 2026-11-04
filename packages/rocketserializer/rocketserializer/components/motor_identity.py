"""Motor identity for ``parameters.json`` (``motors.identity``).

The .ork file only stores the motor's type, manufacturer, designation and
geometry. The total impulse and the burn time are derived from the reference
simulation: the impulse integrates the same thrust curve written to
``thrust_source.csv`` and is checked against the impulse class parsed from the
designation. Missing values are ``None`` (``null`` in JSON), never 0.
"""

import logging
import re

import numpy as np

logger = logging.getLogger(__name__)

# Total impulse range (N*s) per impulse class letter (NAR/TRA classification).
IMPULSE_CLASS_RANGES = {
    "A": (1.26, 2.5),
    "B": (2.51, 5.0),
    "C": (5.01, 10.0),
    "D": (10.01, 20.0),
    "E": (20.01, 40.0),
    "F": (40.01, 80.0),
    "G": (80.01, 160.0),
    "H": (160.01, 320.0),
    "I": (320.01, 640.0),
    "J": (640.01, 1280.0),
    "K": (1280.01, 2560.0),
    "L": (2560.01, 5120.0),
    "M": (5120.01, 10240.0),
    "N": (10240.01, 20480.0),
    "O": (20480.01, 40960.0),
}

_IMPULSE_CLASS_PATTERN = re.compile(r"([A-O])\d")

# Fraction of the peak thrust above which the motor counts as burning when the
# simulation has no ignition/burnout events.
_BURN_THRESHOLD = 0.01

# numpy >= 2 renamed trapz to trapezoid.
_trapezoid = getattr(np, "trapezoid", None) or np.trapz


def parse_impulse_class(designation):
    """Return the impulse class letter of a motor designation.

    The class is the first letter A-O followed by a digit, e.g.
    ``232H123-14A`` -> ``H`` and ``J350W`` -> ``J``. Returns ``None`` when the
    designation has no such letter.
    """
    if not designation:
        return None
    match = _IMPULSE_CLASS_PATTERN.search(designation)
    return match.group(1) if match else None


def check_impulse(thrust_curve, impulse_class):
    """Integrate the thrust curve and check it against the impulse class.

    Parameters
    ----------
    thrust_curve : numpy.ndarray or None
        (n, 2) array of (time, thrust), as written to ``thrust_source.csv``.
    impulse_class : str or None
        Impulse class letter parsed from the designation.

    Returns
    -------
    tuple
        ``(total_impulse_newton_seconds, impulse_check)``. ``impulse_check`` is
        ``"ok"`` when the impulse is inside the class range, ``"class_mismatch"``
        (and the impulse is dropped to ``None``) when it is outside, and
        ``"unchecked"`` when there is no class or no curve to integrate.
    """
    if thrust_curve is None or len(thrust_curve) < 2:
        return None, "unchecked"
    total = float(_trapezoid(thrust_curve[:, 1], thrust_curve[:, 0]))
    if impulse_class is None:
        return total, "unchecked"
    low, high = IMPULSE_CLASS_RANGES[impulse_class]
    if low <= total <= high:
        return total, "ok"
    logger.warning(
        "The integrated total impulse %.2f N*s is outside the class %s range "
        "(%.2f-%.2f N*s); it will not be reported.",
        total,
        impulse_class,
        low,
        high,
    )
    return None, "class_mismatch"


def _event_time(simulation, event_type):
    event = simulation.find("event", attrs={"type": event_type})
    if event is None or event.get("time") is None:
        return None
    try:
        return float(event["time"])
    except ValueError:
        return None


def burn_time_seconds(simulation, thrust_curve):
    """Burn time of the reference simulation, in seconds.

    Burnout event time minus ignition event time when both events exist;
    otherwise the duration during which the thrust is above 1 % of its peak;
    ``None`` when neither is available.
    """
    if simulation is not None:
        ignition = _event_time(simulation, "ignition")
        burnout = _event_time(simulation, "burnout")
        if ignition is not None and burnout is not None:
            return burnout - ignition
    if thrust_curve is None or len(thrust_curve) == 0:
        return None
    peak = float(np.max(thrust_curve[:, 1]))
    if peak <= 0:
        return None
    burning = thrust_curve[thrust_curve[:, 1] > _BURN_THRESHOLD * peak, 0]
    if len(burning) < 2:
        return None
    return float(burning[-1] - burning[0])


def _text(element, tag):
    child = element.find(tag)
    if child is None or not child.text.strip():
        return None
    return child.text.strip()


def _cluster_size(motor):
    """Number of motors a motor mount holds (its ``clusterconfiguration``)."""
    mount = motor.find_parent("motormount")
    holder = mount.parent if mount is not None else None
    cluster = holder.find("clusterconfiguration", recursive=False) if holder else None
    if cluster is None:
        return 1
    value = cluster.text.strip().lower()
    if value == "single":
        return 1
    if value == "double":
        return 2
    match = re.match(r"(\d+)", value)
    return int(match.group(1)) if match else 1


def _simulation_config_id(simulation):
    if simulation is None:
        return None
    conditions = simulation.find("conditions")
    return _text(conditions, "configid") if conditions is not None else None


def search_motor_identity(bs, simulation, thrust_curve):
    """Build ``motors.identity`` for the reference simulation.

    The motor is the one in the reference simulation's configuration
    (fallback: the default configuration; fallback: the first motor). When the
    configuration holds several motors, the identity describes the first one
    and ``motor_count`` says how many there are.

    Parameters
    ----------
    bs : BeautifulSoup
        BeautifulSoup object of the .ork file.
    simulation : bs4.element.Tag or None
        The reference simulation.
    thrust_curve : numpy.ndarray or None
        The thrust curve written to ``thrust_source.csv``.

    Returns
    -------
    dict or None
        The identity, or ``None`` when the file has no motor.
    """
    motors = bs.find_all("motor", attrs={"configid": True})
    if not motors:
        motors = bs.find_all("motor")
        if not motors:
            logger.info("No motor was found in the file.")
            return None

    default = bs.find("motorconfiguration", attrs={"default": "true"})
    candidates = [_simulation_config_id(simulation)]
    candidates.append(default.get("configid") if default is not None else None)

    selected = []
    for config_id in candidates:
        if config_id is None:
            continue
        selected = [m for m in motors if m.get("configid") == config_id]
        if selected:
            break
    if not selected:
        first = motors[0]
        selected = [m for m in motors if m.get("configid") == first.get("configid")]

    motor = selected[0]
    designation = _text(motor, "designation")
    impulse_class = parse_impulse_class(designation)
    total_impulse, impulse_check = check_impulse(thrust_curve, impulse_class)

    identity = {
        "designation": designation,
        "manufacturer": _text(motor, "manufacturer"),
        "ork_motor_type": _text(motor, "type"),
        "config_id": motor.get("configid"),
        "motor_count": sum(_cluster_size(m) for m in selected),
        "impulse_class": impulse_class,
        "total_impulse_newton_seconds": total_impulse,
        "impulse_check": impulse_check,
        "burn_time_seconds": burn_time_seconds(simulation, thrust_curve),
    }
    logger.info("Motor identity: %s", identity)
    return identity
