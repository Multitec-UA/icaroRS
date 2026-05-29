"""Unit tests for rocketpy.environment.tools helpers."""

import numpy as np

from rocketpy.environment.tools import get_pressure_levels_from_file

_DICT = {"level": "level"}


class _FakeVar:
    """Minimal stand-in for a netCDF4 variable: indexable + optional units."""

    def __init__(self, values, units=None):
        self._values = np.asarray(values, dtype=float)
        if units is not None:
            self.units = units

    def __getitem__(self, item):
        return self._values[item]


class _FakeData:
    def __init__(self, var):
        self.variables = {"level": var}


def test_pressure_levels_already_in_pa_are_not_rescaled():
    """UCAR THREDDS GFS delivers the level coordinate in Pa — must pass through
    unchanged (regression: it was being multiplied by 100 → ~100x pressure)."""
    data = _FakeData(_FakeVar([100000.0, 92500.0, 85000.0], units="Pa"))
    levels = get_pressure_levels_from_file(data, _DICT)
    np.testing.assert_allclose(levels, [100000.0, 92500.0, 85000.0])


def test_pressure_levels_in_hpa_are_scaled_to_pa():
    """hPa/mbar sources (e.g. NOMADS/ERA5) must still be converted to Pa."""
    data = _FakeData(_FakeVar([1000.0, 925.0, 850.0], units="hPa"))
    levels = get_pressure_levels_from_file(data, _DICT)
    np.testing.assert_allclose(levels, [100000.0, 92500.0, 85000.0])


def test_pressure_levels_missing_units_pa_magnitude_not_rescaled():
    """No units attribute, Pa-magnitude values → inferred as Pa, unchanged."""
    data = _FakeData(_FakeVar([100000.0, 92500.0]))
    levels = get_pressure_levels_from_file(data, _DICT)
    np.testing.assert_allclose(levels, [100000.0, 92500.0])


def test_pressure_levels_missing_units_hpa_magnitude_scaled():
    """No units attribute, hPa-magnitude values → inferred as hPa, scaled."""
    data = _FakeData(_FakeVar([1000.0, 925.0]))
    levels = get_pressure_levels_from_file(data, _DICT)
    np.testing.assert_allclose(levels, [100000.0, 92500.0])
