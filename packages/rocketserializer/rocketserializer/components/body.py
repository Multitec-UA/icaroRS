import logging
import math

logger = logging.getLogger(__name__)

# XML tag of a stage-level outer-body component -> its OpenRocket class name,
# as recorded in ``elements[...]["type"]`` by ``process_elements_position``.
_BODY_TAGS = {
    "nosecone": "NoseCone",
    "bodytube": "BodyTube",
    "transition": "Transition",
}


_RADIUS_TAGS = {
    "nosecone": ("aftradius",),
    "bodytube": ("radius",),
    "transition": ("foreradius", "aftradius"),
}


def _radius(component, tag, rocket_radius):
    """Parse an .ork radius: ``"0.03"``, ``"auto 0.03"`` or a bare ``"auto"``.

    Same rule as ``get_rocket_radius``: drop the ``auto`` prefix; a bare
    ``auto`` (no value) falls back to the rocket radius.
    """
    value = component.find(tag, recursive=False).text.replace("auto", "").strip()
    return float(value) if value else float(rocket_radius)


def _position(elements, tag, name, length, taken):
    """Absolute front of the component, reused from ``elements``.

    Matches type, name and length; repeated matches pair in order of
    appearance, so two identical tubes keep their own positions.
    """
    kind = _BODY_TAGS[tag]
    for key, element in elements.items():
        if key in taken:
            continue
        if (
            element["type"] == kind
            and element["name"] == name
            and math.isclose(element["length"], length, abs_tol=1e-12)
        ):
            taken.add(key)
            return element["position"]
    logger.error("No %s element named '%s' with length %f", kind, name, length)
    return None


def search_body_segments(bs, elements, rocket_radius):
    """Collect the stage-level symmetric components (the outer body).

    Only nose cones, body tubes and transitions that are direct children of a
    stage count; inner tubes, couplers and rings are internal.

    Returns
    -------
    list of dict
        In axial order, each with ``kind``, ``name``, ``position`` (front, m
        from the nose tip), ``length``, ``fore_radius`` and ``aft_radius``.
    """
    segments = []
    taken = set()
    for stage in bs.find_all("stage"):
        children = stage.find("subcomponents", recursive=False)
        if children is None:
            continue
        for component in children.find_all(list(_BODY_TAGS), recursive=False):
            tag = component.name
            name = component.find("name").text
            if any(
                component.find(field, recursive=False) is None
                for field in ("length", *_RADIUS_TAGS[tag])
            ):
                logger.warning("Skipping body segment '%s': no geometry", name)
                continue
            length = float(component.find("length", recursive=False).text)
            if tag == "bodytube":
                fore = aft = _radius(component, "radius", rocket_radius)
            elif tag == "nosecone":
                base = _radius(component, "aftradius", rocket_radius)
                flipped = component.find("isflipped", recursive=False)
                if flipped is not None and flipped.text.strip() == "true":
                    fore, aft = base, 0.0
                else:
                    fore, aft = 0.0, base
            else:
                fore = _radius(component, "foreradius", rocket_radius)
                aft = _radius(component, "aftradius", rocket_radius)
            segments.append(
                {
                    "kind": tag,
                    "name": name,
                    "position": _position(elements, tag, name, length, taken),
                    "length": length,
                    "fore_radius": fore,
                    "aft_radius": aft,
                }
            )
    segments.sort(key=lambda s: math.inf if s["position"] is None else s["position"])
    logger.info("Collected %d body segments", len(segments))
    return segments
