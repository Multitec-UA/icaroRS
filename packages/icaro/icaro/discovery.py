"""GFS forecast window check and atmosphere model selection.

Pure domain helpers — no network I/O, no rocketpy import.  The rule "choose
between GFS forecast and standard_atmosphere based on date + connectivity" is
encoded here once so the CLI, API, and any future surface never duplicate it.

The helpers are injectable via ``now`` / ``online`` parameters so they are
fully unit-testable without mocking the system clock or the network.

Usage
-----
>>> from icaro.discovery import choose_atmosphere_model_for_date
>>> model, reason = choose_atmosphere_model_for_date(date, online=True)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

# GFS operational forecast horizon — single source of truth.
# The upper bound is EXCLUSIVE: delta_days in [0, GFS_WINDOW_DAYS).
GFS_WINDOW_DAYS: int = 16


def gfs_window_check(
    date: datetime,
    now: Optional[datetime] = None,
) -> bool:
    """Return ``True`` if *date* falls within the GFS forecast window.

    The window is ``[now, now + GFS_WINDOW_DAYS)`` — i.e., from the current
    moment up to (but not including) 16 days ahead.  A past date is always
    outside the window.

    Parameters
    ----------
    date : datetime
        The candidate launch date/time.  Timezone-aware or naive (UTC assumed
        for naive).
    now : datetime or None
        Reference "current" time.  Pass an explicit value in tests; defaults
        to :func:`datetime.now(timezone.utc)` when ``None``.

    Returns
    -------
    bool
        ``True`` if *date* is within ``[now, now + GFS_WINDOW_DAYS)``.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    # Normalise to UTC-aware for safe arithmetic.
    if date.tzinfo is None:
        date = date.replace(tzinfo=timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)

    delta = date - now
    return 0 <= delta.total_seconds() < GFS_WINDOW_DAYS * 86_400


def choose_atmosphere_model_for_date(
    date: Optional[datetime],
    online: bool = True,
    now: Optional[datetime] = None,
) -> tuple[str, str]:
    """Return the recommended atmosphere model and a plain-language reason.

    Decision table (evaluated in order):

    1. ``date`` is ``None``           → ``standard_atmosphere``
       *No launch date provided; using standard atmosphere model.*
    2. ``online=False``               → ``standard_atmosphere``
       *No internet connection available; using standard atmosphere model.*
    3. Within GFS window + online     → ``forecast``
       *Your launch date is within the ~16-day forecast window...*
    4. Outside window (past/far)      → ``standard_atmosphere``
       *Your launch date is outside the ~16-day forecast window...*

    Parameters
    ----------
    date : datetime or None
        Candidate launch date.  ``None`` means "no date was provided".
    online : bool
        Whether outbound internet is available for GFS data fetch.
    now : datetime or None
        Reference "current" time (injected in tests).

    Returns
    -------
    tuple[str, str]
        ``(model_name, human_readable_reason)``  where *model_name* is one of
        ``"forecast"`` or ``"standard_atmosphere"``.
    """
    # Case 1 — no date at all
    if date is None:
        return (
            "standard_atmosphere",
            (
                "No launch date was provided. "
                "Using the standard atmosphere model as a fallback."
            ),
        )

    # Case 2 — offline
    if not online:
        return (
            "standard_atmosphere",
            (
                "No internet connection is available. "
                "Using the standard atmosphere model instead of a live forecast."
            ),
        )

    # Case 3 / 4 — check the GFS window
    if gfs_window_check(date, now=now):
        return (
            "forecast",
            (
                "Your launch date is within the ~16-day GFS forecast window. "
                "Real weather data will be used for the simulation."
            ),
        )

    return (
        "standard_atmosphere",
        (
            "Your launch date is outside the ~16-day forecast window "
            "(too far in the future or in the past). "
            "Using the standard atmosphere model."
        ),
    )
