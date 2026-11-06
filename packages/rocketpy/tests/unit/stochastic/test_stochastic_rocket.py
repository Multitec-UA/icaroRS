import pytest
from rocketpy.rocket.rocket import Rocket


def test_str(stochastic_calisto):
    assert isinstance(str(stochastic_calisto), str)


def test_create_object(stochastic_calisto):
    """Test create object method of StochasticRocket class.

    This test checks if the create_object method of the StochasticCalisto
    class creates a StochasticCalisto object from the randomly generated
    input arguments.

    Parameters
    ----------
    stochastic_calisto : StochasticCalisto
        StochasticCalisto object to be tested.

    Returns
    -------
    None
    """
    obj = stochastic_calisto.create_object()
    assert isinstance(obj, Rocket)


def test_logged_upper_rail_button_follows_coordinate_system(
    calisto_nose_to_tail_robust,
):
    """For a nose_to_tail rocket the upper button sits closer to the nose,
    i.e. at a smaller coordinate than the lower button."""
    from rocketpy.stochastic import StochasticRocket  # pylint: disable=import-outside-toplevel

    rail_buttons = calisto_nose_to_tail_robust.rail_buttons.get_tuple_by_type(
        type(calisto_nose_to_tail_robust.rail_buttons[0].component)
    )[0]
    stochastic = StochasticRocket(rocket=calisto_nose_to_tail_robust)
    stochastic.set_rail_buttons(
        rail_buttons.component, lower_button_position=[rail_buttons.position.z]
    )

    stochastic.create_object()

    logged = stochastic.last_rnd_dict["rail_buttons"][-1]
    distance = rail_buttons.component.buttons_distance
    assert logged["upper_button_position"] == pytest.approx(
        logged["lower_button_position"] - distance
    )
