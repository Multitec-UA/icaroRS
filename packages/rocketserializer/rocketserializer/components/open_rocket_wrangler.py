import logging

from .._helpers import _dict_to_string

logger = logging.getLogger(__name__)


def calculate_distance_to_the_nose_tip(ork, parent_position: float):
    """Axial distance from the nose tip (0) to the front of ``ork``.

    OpenRocket's ``getPosition().x`` is the component's front relative to its
    parent's front, with the axial method (top, middle, bottom, absolute,
    after) already applied. Adding it to the parent's absolute front gives the
    same value as OpenRocket's ``getComponentLocations()``. For fin sets that
    front is the leading edge of the root chord.
    """
    if ork.getClass().getSimpleName() in ["Rocket"]:
        return 0.0
    return float(parent_position + ork.getPosition().x)


def process_elements_position(
    ork, elements, center_of_dry_mass, rocket_mass, top_position=0
):
    """Collect every component with its axial position from the nose tip.

    ``top_position`` is the absolute front of ``ork``'s parent (0 for the
    rocket itself).
    """
    if ork.getClass().getSimpleName() in ["Parachute", "MassComponent"]:
        # These classes are irrelevant for our work
        return elements

    element = {
        "type": str(ork.getClass().getSimpleName()),
        "name": str(ork.getName()),
        "length": float(ork.getLength()),
        "position": calculate_distance_to_the_nose_tip(ork, top_position),
    }
    # Children are positioned relative to this component, never to their
    # siblings: rail buttons, inner tubes and fin sets share the same parent.
    own_position = element["position"]
    logger.info(
        "Starting to process element '%s' of type '%s'",
        ork.getName(),
        ork.getClass().getSimpleName(),
    )
    unique_id = hash(frozenset(element.items()))
    elements[unique_id] = element
    i = 0

    while True:
        if i >= ork.getChildCount():
            logger.info("No more children for '%s'", ork.getName())
            break

        try:
            child = ork.getChild(i)
            new_elements = process_elements_position(
                child, {}, center_of_dry_mass, rocket_mass, own_position
            )
            elements.update(new_elements)
            logger.info("Child '%s' processed", child.getName())

            i += 1
            logger.info("Moving to the next child")

        except Exception as e:  # pylint: disable=broad-except
            if "IndexOutOfBoundsException" in str(e):
                logger.warning(
                    "Index out of bounds - likely no more children to process."
                )
                break
            else:
                logger.error(
                    "Error while processing the position of the elements: %s",
                    e,
                    exc_info=True,
                )
                logger.info(
                    "The elements are:\n%s",
                    _dict_to_string(elements, indent=23),
                )
                print(e)
                break  # Exit the loop if an unexpected error occurs

    logger.info("Finished processing '%s'", ork.getName())
    return elements
