"""Unit tests for search_free_form_fins.

These tests are JVM-free — they use inline XML snippets parsed by BeautifulSoup
and do NOT require OpenRocket or the JVM to be running.
"""

from bs4 import BeautifulSoup

from rocketserializer.components.fins import search_free_form_fins

# ---------------------------------------------------------------------------
# Shared fixtures (inline XML + elements dict)
# ---------------------------------------------------------------------------

_FREEFORM_XML = """\
<openrocket>
  <rocket>
    <freeformfinset>
      <name>TestFin</name>
      <fincount>4</fincount>
      <cant>0.0</cant>
      <crosssection>square</crosssection>
      <finpoints>
        <point x="0.0"   y="0.0"/>
        <point x="0.025" y="0.05"/>
        <point x="0.075" y="0.05"/>
        <point x="0.05"  y="0.0"/>
      </finpoints>
    </freeformfinset>
  </rocket>
</openrocket>
"""

_ELEMENTS = {0: {"name": "TestFin", "position": 0.5}}


def _bs(xml):
    """Parse an XML string into a BeautifulSoup object using the xml parser."""
    return BeautifulSoup(xml, "xml")


# ---------------------------------------------------------------------------
# Task 1.1 — empty case baseline (passes even against the stub)
# ---------------------------------------------------------------------------


def test_search_free_form_fins_empty():
    """No <freeformfinset> → returns {} without error."""
    bs = _bs("<openrocket/>")
    result = search_free_form_fins(bs, {})
    assert result == {}


# ---------------------------------------------------------------------------
# Task 1.2 — coordinate transform (RED until implementation)
# ---------------------------------------------------------------------------


def test_search_free_form_fins_coordinate_transform():
    """Points are passed through unchanged: OpenRocket finpoints already use
    +x toward the tail and (0,0) at the root leading edge, matching RocketPy's
    add_free_form_fins convention. No negation. Order preserved."""
    bs = _bs(_FREEFORM_XML)
    result = search_free_form_fins(bs, _ELEMENTS)

    assert 0 in result, "Result must be integer-keyed starting at 0"
    shape = result[0]["shape_points"]

    expected = [
        [0.0, 0.0],
        [0.025, 0.05],
        [0.075, 0.05],
        [0.05, 0.0],
    ]
    assert shape == expected, (
        f"Coordinate transform failed.\nGot:      {shape}\nExpected: {expected}"
    )


# ---------------------------------------------------------------------------
# Task 1.3 — field values (RED until implementation)
# ---------------------------------------------------------------------------


def test_search_free_form_fins_fields():
    """Verify name, number (int), cant_angle (float), position (float)."""
    bs = _bs(_FREEFORM_XML)
    result = search_free_form_fins(bs, _ELEMENTS)

    assert 0 in result, "Result must be integer-keyed starting at 0"
    fin = result[0]

    assert fin["name"] == "TestFin"
    assert fin["number"] == 4
    assert isinstance(fin["number"], int)
    assert fin["cant_angle"] == 0.0
    assert isinstance(fin["cant_angle"], float)
    assert fin["position"] == 0.5
    assert "shape_points" in fin
    assert isinstance(fin["shape_points"], list)
