import logging

from ._helpers import _dict_to_string
from .components.body import search_body_segments
from .components.drag_curve import save_drag_curve
from .components.environment import search_environment
from .components.fins import (
    search_elliptical_fins,
    search_free_form_fins,
    search_trapezoidal_fins,
)
from .components.flight import search_launch_conditions
from .components.id import search_id_info
from .components.motor import (
    __get_motor_mass,
    build_thrust_curve,
    generate_thrust_curve,
    search_motor,
)
from .components.motor_identity import search_motor_identity
from .components.nose_cone import search_nosecone
from .components.open_rocket_wrangler import process_elements_position
from .components.parachute import search_parachutes
from .components.rail_buttons import search_rail_buttons
from .components.rocket import search_rocket
from .components.stored_results import search_stored_results
from .components.transition import search_transitions

logger = logging.getLogger(__name__)


def ork_extractor(bs, filepath, output_folder, ork):
    """Generates the parameters.json file with the parameters for rocketpy

    Parameters
    ----------
    bs : BeautifulSoup
        BeautifulSoup object of the .ork file.
    filepath : str
        Path to the .ork file.
    output_folder : str
        Path to the output folder.
    ork : orhelper
        An object representing the OpenRocket document.
    verbose : bool, optional
        Whether or not to print a message of successful execution, by default
        False.

    Returns
    -------
    dictionary
        Dictionary with the parameters to be used in rocketpy simulations. The
        keys are: "id", "environment", "rocket", "nosecones", "trapezoidal_fins",
        "tails", "parachutes", "rail_buttons", "motors", "flight" and
        "stored_results".
    """
    settings = {}

    # Pick the one simulation that feeds the stored results and the series
    simulation, selection = select_reference_simulation(bs)
    logger.info("Reference simulation selected by rule: %s", selection)

    # Initialize some important vectors
    datapoints, data_labels, time_vector = __init_vectors(bs, simulation)
    logger.info("Initialized data vectors from the ORK file.")

    # Retrieve the motor properties
    motors = search_motor(bs, datapoints, data_labels)
    _, _, burnout_position = __get_motor_mass(datapoints, data_labels)
    logger.info("Motor parameters retrieved.")

    # Get the first set of parameters
    id_info = search_id_info(bs, filepath)
    logger.info("Metadata parameters retrieved.")

    environment = search_environment(bs)
    logger.info("Environment parameters retrieved.")

    rocket, motor_position = search_rocket(
        bs, datapoints, data_labels, burnout_position
    )
    motors["position"] = motor_position
    logger.info("Rocket parameters retrieved.")

    flight = search_launch_conditions(bs)
    logger.info("Flight conditions retrieved.")

    # process different elements of the rocket
    center_of_dry_mass = rocket["center_of_mass_without_propellant"]
    rocket_mass = rocket["mass"]
    rocket_radius = rocket["radius"]

    elements = process_elements_position(
        ork.getRocket(), {}, center_of_dry_mass, rocket_mass, top_position=0
    )
    logger.info("The elements are:\n%s", _dict_to_string(elements, indent=23))

    nosecones = search_nosecone(bs, elements, rocket_radius)
    trapezoidal_fins = search_trapezoidal_fins(bs, elements)
    elliptical_fins = search_elliptical_fins(bs, elements)
    freeform_fins = search_free_form_fins(bs, elements)
    transitions = search_transitions(bs, elements, ork)
    body_segments = search_body_segments(bs, elements, rocket_radius)
    rail_buttons = search_rail_buttons(bs, elements)
    parachutes = search_parachutes(bs)
    stored_results = search_stored_results(
        bs,
        datapoints,
        data_labels,
        time_vector,
        burnout_position,
        simulation=simulation,
        selection=selection,
    )

    # save everything to a dictionary
    settings["id"] = id_info
    settings["environment"] = environment
    settings["rocket"] = rocket
    settings["nosecones"] = nosecones
    settings["trapezoidal_fins"] = trapezoidal_fins
    settings["elliptical_fins"] = elliptical_fins
    settings["freeform_fins"] = freeform_fins
    settings["tails"] = transitions
    settings["body_segments"] = body_segments
    settings["parachutes"] = parachutes
    settings["rail_buttons"] = rail_buttons
    settings["motors"] = motors
    settings["flight"] = flight
    settings["stored_results"] = stored_results

    # get drag curves
    settings["rocket"]["drag_curve"] = save_drag_curve(
        datapoints, data_labels, output_folder
    )
    logger.info("Drag curve generated.")

    # get thrust curve
    thrust_path = generate_thrust_curve(
        output_folder, datapoints, data_labels, time_vector
    )
    settings["motors"]["thrust_source"] = thrust_path
    logger.info("Thrust curve generated.")

    # motor identity, from the same thrust curve written to thrust_source.csv
    try:
        thrust_curve = build_thrust_curve(datapoints, data_labels, time_vector)
    except ValueError:
        thrust_curve = None
    settings["motors"]["identity"] = search_motor_identity(
        bs, simulation, thrust_curve
    )
    logger.info("Motor identity retrieved.")

    logger.info(
        "Extraction completed. A dictionary with all the parameters was generated."
    )
    logger.info(
        "Dictionary with the parameters:\n%s", _dict_to_string(settings, indent=23)
    )

    return settings


_STATUS_RULES = (
    ("uptodate", True, "uptodate_default"),
    ("uptodate", False, "uptodate_other"),
    ("loaded", True, "loaded_default"),
    ("loaded", False, "loaded_other"),
)


def _simulation_config_id(simulation):
    conditions = simulation.find("conditions")
    configid = conditions.find("configid") if conditions is not None else None
    return configid.text.strip() if configid is not None else None


def select_reference_simulation(bs):
    """Select the simulation whose results and series feed the manifest.

    Only simulations with flight data (a ``<flightdata>`` holding at least one
    ``<datapoint>``) are eligible. In order: the first ``uptodate`` simulation
    of the default motor configuration (``uptodate_default``), the first
    ``uptodate`` one (``uptodate_other``), the first ``loaded`` one of the
    default configuration (``loaded_default``), the first ``loaded`` one
    (``loaded_other``), and finally the first eligible simulation of any
    status (``fallback``).

    Parameters
    ----------
    bs : BeautifulSoup
        BeautifulSoup object of the .ork file.

    Returns
    -------
    tuple
        ``(simulation, selection)``: the ``<simulation>`` tag and the rule that
        selected it, or ``(None, None)`` when no simulation has flight data.
    """
    eligible = []
    for simulation in bs.find_all("simulation"):
        flightdata = simulation.find("flightdata")
        if flightdata is not None and flightdata.find("datapoint") is not None:
            eligible.append(simulation)
    if not eligible:
        logger.warning("No simulation with flight data was found.")
        return None, None

    default = bs.find("motorconfiguration", attrs={"default": "true"})
    default_id = default.get("configid") if default is not None else None

    for status, needs_default, selection in _STATUS_RULES:
        for simulation in eligible:
            if simulation.get("status") != status:
                continue
            if needs_default and (
                default_id is None or _simulation_config_id(simulation) != default_id
            ):
                continue
            return simulation, selection
    return eligible[0], "fallback"


def __init_vectors(bs, simulation=None):
    """Initializes the vectors with the data from the .ork file.

    Parameters
    ----------
    bs : BeautifulSoup
        BeautifulSoup object of the .ork file.
    simulation : bs4.element.Tag, optional
        The reference simulation. When given, the series come from its flight
        data only; otherwise from every datapoint of the document (legacy).

    Returns
    -------
    datapoints : list
        The datapoints.
    data_labels : list
        The names of each data column.
    time_vector : list
        The time vector.
    """
    source = simulation if simulation is not None else bs
    datapoints = source.findAll("datapoint")
    data_labels = source.find("databranch").attrs["types"].split(",")

    time_vector = [float(datapoint.text.split(",")[0]) for datapoint in datapoints]
    start_pos = 0
    final_pos = len(time_vector) - 1

    # Get the start position, the ignition time.
    for idx, position in enumerate(time_vector):
        if position == 0:
            start_pos = idx

    # Filter the datapoints to get only the ones after the ignition.
    datapoints = datapoints[start_pos:final_pos]
    time_vector = time_vector[start_pos:final_pos]
    logger.info("Successfully initialized vectors with %d datapoints", len(datapoints))
    return datapoints, data_labels, time_vector
