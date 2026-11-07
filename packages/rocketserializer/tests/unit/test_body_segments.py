"""Unit tests for ``search_body_segments`` (no JVM: XML snippet + fake elements)."""

import pytest
from bs4 import BeautifulSoup

from rocketserializer.components.body import search_body_segments

ORK_XML = """<?xml version='1.0' encoding='utf-8'?>
<openrocket>
  <rocket>
    <name>Test</name>
    <subcomponents>
      <stage>
        <name>Sustainer</name>
        <subcomponents>
          <nosecone>
            <name>Nose</name>
            <length>0.2</length>
            <shape>ogive</shape>
            <aftradius>auto 0.04</aftradius>
          </nosecone>
          <bodytube>
            <name>Upper</name>
            <length>0.5</length>
            <radius>0.04</radius>
            <subcomponents>
              <innertube>
                <name>Motor mount</name>
                <length>0.3</length>
                <outerradius>0.02</outerradius>
              </innertube>
              <tubecoupler>
                <name>Coupler</name>
                <length>0.1</length>
                <outerradius>0.039</outerradius>
              </tubecoupler>
            </subcomponents>
          </bodytube>
          <transition>
            <name>Boattail</name>
            <length>0.1</length>
            <foreradius>auto 0.04</foreradius>
            <aftradius>0.025</aftradius>
          </transition>
          <bodytube>
            <name>Lower</name>
            <length>0.3</length>
            <radius>auto</radius>
          </bodytube>
        </subcomponents>
      </stage>
    </subcomponents>
  </rocket>
</openrocket>
"""


def _element(kind, name, length, position):
    return {"type": kind, "name": name, "length": length, "position": position}


ELEMENTS = {
    1: _element("Rocket", "Test", 0.0, 0.0),
    2: _element("AxialStage", "Sustainer", 1.1, 0.0),
    3: _element("NoseCone", "Nose", 0.2, 0.0),
    4: _element("BodyTube", "Upper", 0.5, 0.2),
    5: _element("InnerTube", "Motor mount", 0.3, 0.4),
    6: _element("TubeCoupler", "Coupler", 0.1, 0.2),
    7: _element("Transition", "Boattail", 0.1, 0.7),
    8: _element("BodyTube", "Lower", 0.3, 0.8),
}


@pytest.fixture
def segments():
    bs = BeautifulSoup(ORK_XML, features="xml")
    return search_body_segments(bs, ELEMENTS, rocket_radius=0.045)


def test_segments_are_the_stage_level_outer_body_in_axial_order(segments):
    assert [(s["kind"], s["name"]) for s in segments] == [
        ("nosecone", "Nose"),
        ("bodytube", "Upper"),
        ("transition", "Boattail"),
        ("bodytube", "Lower"),
    ]


def test_inner_tubes_and_couplers_are_excluded(segments):
    names = {s["name"] for s in segments}
    assert "Motor mount" not in names
    assert "Coupler" not in names


def test_positions_and_lengths_come_from_the_elements(segments):
    assert [s["position"] for s in segments] == pytest.approx([0.0, 0.2, 0.7, 0.8])
    assert [s["length"] for s in segments] == pytest.approx([0.2, 0.5, 0.1, 0.3])


def test_nose_cone_runs_from_zero_to_its_base_radius(segments):
    nose = segments[0]
    assert nose["fore_radius"] == 0.0
    assert nose["aft_radius"] == pytest.approx(0.04)  # "auto 0.04"


def test_body_tube_has_equal_fore_and_aft_radius(segments):
    upper = segments[1]
    assert upper["fore_radius"] == upper["aft_radius"] == pytest.approx(0.04)


def test_transition_keeps_its_two_radii(segments):
    boattail = segments[2]
    assert boattail["fore_radius"] == pytest.approx(0.04)  # "auto 0.04"
    assert boattail["aft_radius"] == pytest.approx(0.025)


def test_bare_auto_radius_falls_back_to_the_rocket_radius(segments):
    lower = segments[3]
    assert lower["fore_radius"] == lower["aft_radius"] == pytest.approx(0.045)


def test_segment_has_exactly_the_contract_keys(segments):
    for segment in segments:
        assert set(segment) == {
            "kind",
            "name",
            "position",
            "length",
            "fore_radius",
            "aft_radius",
        }


def test_component_without_geometry_is_skipped():
    xml = (
        "<openrocket><rocket><subcomponents><stage><subcomponents>"
        "<nosecone><name>Stub</name></nosecone>"
        "</subcomponents></stage></subcomponents></rocket></openrocket>"
    )
    bs = BeautifulSoup(xml, features="xml")
    assert search_body_segments(bs, {}, rocket_radius=0.05) == []
