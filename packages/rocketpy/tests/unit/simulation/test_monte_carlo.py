import json
import warnings
from unittest.mock import patch

import matplotlib as plt
import numpy as np
import pytest

from rocketpy.simulation import MonteCarlo

plt.rcParams.update({"figure.max_open_warning": 0})


def test_stochastic_environment_create_object_with_wind_x(stochastic_environment):
    """Tests the stochastic environment object by checking if the wind velocity
    can be generated properly. The goal is to check if the create_object()
    method is being called without any problems.

    Parameters
    ----------
    stochastic_environment : StochasticEnvironment
        The stochastic environment object, this is a pytest fixture.
    """
    wind_x_at_1000m = []
    for _ in range(10):
        random_env = stochastic_environment.create_object()
        wind_x_at_1000m.append(random_env.wind_velocity_x(1000))

    assert np.isclose(np.mean(wind_x_at_1000m), 0, atol=0.1)
    assert np.isclose(np.std(wind_x_at_1000m), 0, atol=0.1)
    # TODO: add a new test for the special case of ensemble member


def test_stochastic_solid_motor_create_object_with_impulse(stochastic_solid_motor):
    """Tests the stochastic solid motor object by checking if the total impulse
    can be generated properly. The goal is to check if the create_object()
    method is being called without any problems.

    Parameters
    ----------
    stochastic_solid_motor : StochasticSolidMotor
        The stochastic solid motor object, this is a pytest fixture.
    """
    total_impulse = [
        stochastic_solid_motor.create_object().total_impulse for _ in range(200)
    ]

    assert np.isclose(np.mean(total_impulse), 6500, rtol=0.3)
    assert np.isclose(np.std(total_impulse), 1000, rtol=0.4)


def test_stochastic_calisto_create_object_with_static_margin(stochastic_calisto):
    """Tests the stochastic calisto object by checking if the static margin
    can be generated properly. The goal is to check if the create_object()
    method is being called without any problems.

    Parameters
    ----------
    stochastic_calisto : StochasticCalisto
        The stochastic calisto object, this is a pytest fixture.
    """

    all_margins = []
    for _ in range(10):
        random_rocket = stochastic_calisto.create_object()
        all_margins.append(random_rocket.static_margin(0))

    assert np.isclose(np.mean(all_margins), 2.2625350013000434, rtol=0.15)
    assert np.isclose(np.std(all_margins), 0.1, atol=0.2)


class MockMonteCarlo(MonteCarlo):
    """Create a mock class to test the method without running a real simulation"""

    def __init__(self):
        # pylint: disable=super-init-not-called

        # Simulate pre-calculated results
        # Example: a normal distribution centered on 100 for the apogee
        self.results = {
            "apogee": [98, 102, 100, 99, 101, 100, 97, 103],
            "max_velocity": [250, 255, 245, 252, 248],
            "single_point": [100],
            "empty_attribute": [],
        }


def test_estimate_confidence_interval_contains_known_mean():
    """Checks that the confidence interval contains the known mean."""
    mc = MockMonteCarlo()

    ci = mc.estimate_confidence_interval("apogee", confidence_level=0.95)

    assert ci.low < 100 < ci.high
    assert ci.low < ci.high


def test_estimate_confidence_interval_supports_custom_statistic():
    """Checks that the statistic can be changed (e.g., standard deviation instead of mean)."""
    mc = MockMonteCarlo()

    ci_std = mc.estimate_confidence_interval("apogee", statistic=np.std)

    assert ci_std.low > 0
    assert ci_std.low < ci_std.high


def test_estimate_confidence_interval_raises_value_error_when_attribute_missing():
    """Checks that the code raises an error if the key does not exist."""
    mc = MockMonteCarlo()

    # Request a variable that does not exist ("altitude" is not in our mock)
    with pytest.raises(ValueError) as excinfo:
        mc.estimate_confidence_interval("altitude")

    assert "not found in results" in str(excinfo.value)


def test_estimate_confidence_interval_increases_width_with_higher_confidence_level():
    """Checks that a higher confidence level yields a wider interval."""
    mc = MockMonteCarlo()

    ci_90 = mc.estimate_confidence_interval("apogee", confidence_level=0.90)
    width_90 = ci_90.high - ci_90.low

    ci_99 = mc.estimate_confidence_interval("apogee", confidence_level=0.99)
    width_99 = ci_99.high - ci_99.low

    # The more confident we want to be (99%), the wider the interval must be
    assert width_99 >= width_90


def test_estimate_confidence_interval_raises_value_error_when_confidence_level_out_of_bounds():
    """Checks that validation fails if confidence_level is not strictly between 0 and 1."""
    mc = MockMonteCarlo()

    # Case 1: Value <= 0
    with pytest.raises(ValueError, match="confidence_level must be between 0 and 1"):
        mc.estimate_confidence_interval("apogee", confidence_level=0)

    with pytest.raises(ValueError, match="confidence_level must be between 0 and 1"):
        mc.estimate_confidence_interval("apogee", confidence_level=-0.5)

    # Case 2: Value >= 1
    with pytest.raises(ValueError, match="confidence_level must be between 0 and 1"):
        mc.estimate_confidence_interval("apogee", confidence_level=1)

    with pytest.raises(ValueError, match="confidence_level must be between 0 and 1"):
        mc.estimate_confidence_interval("apogee", confidence_level=1.5)


def test_estimate_confidence_interval_raises_value_error_when_n_resamples_invalid():
    """Checks that validation fails if n_resamples is not a positive integer."""
    mc = MockMonteCarlo()

    # Case 1: Not an integer (e.g. float)
    with pytest.raises(ValueError, match="n_resamples must be a positive integer"):
        mc.estimate_confidence_interval("apogee", n_resamples=1000.5)

    # Case 2: Zero or Negative
    with pytest.raises(ValueError, match="n_resamples must be a positive integer"):
        mc.estimate_confidence_interval("apogee", n_resamples=0)

    with pytest.raises(ValueError, match="n_resamples must be a positive integer"):
        mc.estimate_confidence_interval("apogee", n_resamples=-100)


def test_estimate_confidence_interval_raises_value_error_on_empty_data_list():
    """Checks behavior when the attribute exists but contains no data (empty list)."""
    mc = MockMonteCarlo()

    with pytest.raises(ValueError):
        mc.estimate_confidence_interval("empty_attribute")


def test_estimate_confidence_interval_handles_single_data_point():
    """Checks behavior with only one data point. The CI should be [val, val]."""
    mc = MockMonteCarlo()

    with pytest.raises(ValueError):  # two or more value
        mc.estimate_confidence_interval("single_point", n_resamples=50)


def test_estimate_confidence_interval_raises_type_error_for_invalid_statistic():
    """Checks that passing a non-callable object (like a string/int) as statistic raises TypeError."""
    mc = MockMonteCarlo()
    with pytest.raises(TypeError):
        mc.estimate_confidence_interval("apogee", statistic=1)

    with pytest.raises(TypeError):
        mc.estimate_confidence_interval("apogee", statistic="not_a_function")


class _FlakyFlight:
    """Stand-in for ``Flight`` whose calls fail on the given (1-based) attempts."""

    def __init__(self, failing_attempts):
        self.failing_attempts = set(failing_attempts)
        self.calls = 0

    def __call__(self, **_kwargs):
        self.calls += 1
        if self.calls in self.failing_attempts:
            raise ValueError(f"diverged on attempt {self.calls}")
        return object()


def _read_ndjson(path):
    with open(path, encoding="utf-8") as file:
        return [json.loads(line) for line in file.read().splitlines()]


def _run_with_flaky_flight(monte_carlo, failing_attempts, n, **kwargs):
    flaky = _FlakyFlight(failing_attempts)
    with (
        patch("rocketpy.simulation.monte_carlo.Flight", flaky),
        patch.object(
            MonteCarlo,
            "_MonteCarlo__evaluate_flight_outputs",
            lambda self, flight, idx: json.dumps({"index": idx, "apogee": 1.0})
            + "\n",
        ),
    ):
        monte_carlo.simulate(number_of_simulations=n, **kwargs)
    return flaky


@pytest.fixture
def tmp_monte_carlo(stochastic_environment, stochastic_calisto, stochastic_flight, tmp_path):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        return MonteCarlo(
            filename=tmp_path / "mc",
            environment=stochastic_environment,
            rocket=stochastic_calisto,
            flight=stochastic_flight,
        )


def test_skip_failed_simulations_continues_and_logs_failed_inputs(tmp_monte_carlo):
    """A failing flight is logged with its inputs and the run keeps going."""
    flaky = _run_with_flaky_flight(
        tmp_monte_carlo, failing_attempts=[2], n=4, skip_failed_simulations=True
    )

    assert flaky.calls == 4
    outputs = _read_ndjson(tmp_monte_carlo.output_file)
    inputs = _read_ndjson(tmp_monte_carlo.input_file)
    errors = _read_ndjson(tmp_monte_carlo.error_file)
    assert len(outputs) == 3
    assert len(inputs) == 3
    assert len(errors) == 1
    assert errors[0]["index"] == 2
    assert errors[0]["error"] == "ValueError: diverged on attempt 2"
    # the failed flight's sampled inputs are kept, not an empty line
    assert set(inputs[0]) - {"index"} <= set(errors[0])
    assert len(set(errors[0]) - {"index", "error"}) > 0


def test_failed_simulation_still_aborts_by_default_and_logs_its_inputs(
    tmp_monte_carlo,
):
    """Default behaviour is unchanged: the first failure aborts the run, and
    the error file now holds the failed flight's inputs instead of an empty line."""
    with pytest.raises(ValueError, match="diverged on attempt 2"):
        _run_with_flaky_flight(tmp_monte_carlo, failing_attempts=[2], n=4)

    outputs = _read_ndjson(tmp_monte_carlo._output_file)
    errors = _read_ndjson(tmp_monte_carlo._error_file)
    assert len(outputs) == 1
    assert len(errors) == 1
    assert errors[0]["index"] == 2
    assert len(set(errors[0]) - {"index"}) > 0


def test_successful_run_leaves_error_file_empty(tmp_monte_carlo):
    """Without failures the flag changes nothing."""
    _run_with_flaky_flight(
        tmp_monte_carlo, failing_attempts=[], n=3, skip_failed_simulations=True
    )

    assert len(_read_ndjson(tmp_monte_carlo.output_file)) == 3
    assert _read_ndjson(tmp_monte_carlo.error_file) == []
