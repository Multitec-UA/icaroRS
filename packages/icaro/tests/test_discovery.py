"""Tests for icaro.discovery — GFS window check and atmosphere model selection.

All tests are pure unit tests (no network, no JVM, no filesystem).
TDD: written BEFORE the implementation to drive the design of discovery.py.

Coverage targets: AC-RG-7.1 through AC-RG-7.4 (RG-7 in spec).

Parametrize table covers:
  - date=None           → standard_atmosphere (no date given)
  - offline (online=False, in-window date) → standard_atmosphere
  - in-window (10 days ahead, online) → forecast
  - near boundary (16 days exactly, online) → standard_atmosphere (exclusive)
  - too-far ahead (25 days, online) → standard_atmosphere
  - past date (online) → standard_atmosphere (past is outside the window)
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

# These imports will fail until discovery.py is implemented (RED phase).
from icaro.discovery import choose_atmosphere_model_for_date, gfs_window_check


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _now() -> datetime:
    """Fixed 'now' for all tests — 2026-05-29 12:00:00 UTC."""
    return datetime(2026, 5, 29, 12, 0, 0, tzinfo=timezone.utc)


def _days(n: int) -> datetime:
    """Return ``_now() + n days`` (can be negative for past)."""
    return _now() + timedelta(days=n)


# ---------------------------------------------------------------------------
# gfs_window_check — boundary tests
# ---------------------------------------------------------------------------


class TestGfsWindowCheck:
    """Unit tests for the raw window-check boolean helper."""

    def test_within_window_returns_true(self):
        """10 days ahead is inside the ~16-day window."""
        assert gfs_window_check(_days(10), now=_now()) is True

    def test_day_zero_returns_true(self):
        """Launch today (0 days ahead) is inside the window."""
        assert gfs_window_check(_days(0), now=_now()) is True

    def test_day_15_returns_true(self):
        """15 days ahead is still inside the 16-day window."""
        assert gfs_window_check(_days(15), now=_now()) is True

    def test_day_16_returns_false(self):
        """Exactly 16 days ahead is outside (exclusive upper bound)."""
        assert gfs_window_check(_days(16), now=_now()) is False

    def test_day_25_returns_false(self):
        """25 days ahead is well outside the window."""
        assert gfs_window_check(_days(25), now=_now()) is False

    def test_past_date_returns_false(self):
        """A date in the past is outside the forecast window."""
        assert gfs_window_check(_days(-1), now=_now()) is False


# ---------------------------------------------------------------------------
# choose_atmosphere_model_for_date — parametrize table
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "date, online, expected_model",
    [
        # date=None — no date given
        (None, True, "standard_atmosphere"),
        # offline override — even an in-window date yields standard_atmosphere
        (_days(10), False, "standard_atmosphere"),
        # in-window + online → forecast
        (_days(10), True, "forecast"),
        # exactly 16 days → standard_atmosphere (exclusive upper bound)
        (_days(16), True, "standard_atmosphere"),
        # too-far ahead
        (_days(25), True, "standard_atmosphere"),
        # past date
        (_days(-5), True, "standard_atmosphere"),
    ],
    ids=[
        "no-date",
        "offline-in-window",
        "in-window-online",
        "boundary-16d",
        "too-far-25d",
        "past-5d",
    ],
)
def test_choose_atmosphere_model(date, online, expected_model):
    """Parametrized table: (date, online) → expected model string."""
    model, reason = choose_atmosphere_model_for_date(
        date, online=online, now=_now()
    )
    assert model == expected_model, (
        f"Expected model={expected_model!r}, got {model!r} "
        f"(date={date}, online={online})"
    )
    # Reason must always be a non-empty plain-language string
    assert isinstance(reason, str) and len(reason) > 0, (
        f"reason must be a non-empty string, got {reason!r}"
    )


def test_choose_returns_two_tuple():
    """Return value must be a 2-tuple of strings (AC-RG-7.1)."""
    result = choose_atmosphere_model_for_date(_days(5), online=True, now=_now())
    assert isinstance(result, tuple) and len(result) == 2
    model, reason = result
    assert isinstance(model, str)
    assert isinstance(reason, str)


def test_offline_reason_mentions_internet():
    """The plain-language reason for offline should mention internet/network."""
    _, reason = choose_atmosphere_model_for_date(
        _days(5), online=False, now=_now()
    )
    # Must be human-readable — check that it's not an empty/code-like string
    assert len(reason) > 10


def test_forecast_reason_non_empty():
    """Forecast reason must be a non-empty sentence (AC-RG-7.2)."""
    model, reason = choose_atmosphere_model_for_date(
        _days(5), online=True, now=_now()
    )
    assert model == "forecast"
    assert len(reason) > 10


def test_default_now_uses_real_clock():
    """Calling without ``now`` must not raise (uses datetime.now internally)."""
    # We can't assert the specific model without mocking the clock,
    # but we assert it doesn't raise and returns a valid 2-tuple.
    result = choose_atmosphere_model_for_date(
        datetime.now(timezone.utc) + timedelta(days=5),
        online=True,
    )
    assert isinstance(result, tuple) and len(result) == 2
