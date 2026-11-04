import logging
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from .._helpers import _dict_to_string

logger = logging.getLogger(__name__)


def search_id_info(bs, filepath):
    """Searches for the identification of the .ork file

    Parameters
    ----------
    bs : BeautifulSoup
        BeautifulSoup object of the .ork file.
    filepath : str
        Path to the .ork file.

    Returns
    -------
    dictionary
        Dictionary with the identification information of the .ork file. The
        keys are: "rocket_name", "comment", "designer", "filepath",
        "ork_format_version" (the ``<openrocket version>`` file-format version),
        "creator" (the application that saved the file) and
        "serializer_version" (this package's version, ``None`` if unknown).
    """
    settings = {}
    settings["rocket_name"] = bs.find("rocket").find("name").text
    logger.info("Collected the rocket name: '%s'", settings["rocket_name"])

    try:
        settings["comment"] = bs.find("rocket").find("comment").text.replace("\n", "")
        logger.info("Collected the comment saved in the file: %s", settings["comment"])
    except AttributeError:
        logger.warning("No auxiliary comment was found in the file.")
        settings["comment"] = None
    try:
        settings["designer"] = bs.find("rocket").find("designer").text
        logger.info("Collected the designer name: %s", settings["designer"])
    except AttributeError:
        logger.warning("No designer name was found in the file.")
        settings["designer"] = None
    # settings["ork_version"] = bs.attrs["creator"]
    settings["filepath"] = Path(filepath).as_posix()

    root = bs.find("openrocket")
    settings["ork_format_version"] = root.get("version") if root is not None else None
    settings["creator"] = root.get("creator") if root is not None else None
    try:
        settings["serializer_version"] = version("rocketserializer")
    except PackageNotFoundError:
        settings["serializer_version"] = None

    logger.info(
        "Identification information extracted.\n %s",
        _dict_to_string(settings, indent=23),
    )
    return settings
