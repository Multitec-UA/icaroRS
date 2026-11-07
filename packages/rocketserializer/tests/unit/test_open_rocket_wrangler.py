"""Unit tests for the axial positions computed by process_elements_position.

JVM-free: OpenRocket components are faked with the few methods the wrangler
calls. Each fake's ``getPosition().x`` is what OpenRocket returns for a real
component: its front, relative to its parent's front, with the axial method
(TOP, MIDDLE, BOTTOM, ABSOLUTE, AFTER) already applied.

The tree reproduces MT1 v1.7.0: a fin set that sits after rail buttons and
inner tubes inside the "Aletas" body tube.
"""

from types import SimpleNamespace

import pytest

from rocketserializer.components.open_rocket_wrangler import (
    process_elements_position,
)


class FakeComponent:
    def __init__(self, kind, name, length, x, children=()):
        self.kind, self.name, self.length, self.x = kind, name, length, x
        self.children = list(children)

    def getClass(self):
        return SimpleNamespace(getSimpleName=lambda: self.kind)

    def getName(self):
        return self.name

    def getLength(self):
        return self.length

    def getPosition(self):
        return SimpleNamespace(x=self.x)

    def getChildCount(self):
        return len(self.children)

    def getChild(self, i):
        return self.children[i]


def _fins_tube_children():
    # x values are what OpenRocket reports for MT1 v1.7.0 (relative to the
    # "Aletas" front at 1.18 m).
    return [
        FakeComponent("RailButton", "Rail Button bajo", 0.0, 0.185),
        FakeComponent("RailButton", "Rail Button medio", 0.0, 0.065),
        FakeComponent("InnerTube", "Portamotor", 0.186, 0.014),
        FakeComponent("InnerTube", "cono superior motor", 0.03, -0.016),
        FakeComponent("FreeformFinSet", "Aletas de forma libre", 0.2, 0.0),
    ]


def _mt1_rocket(fins_tube_children):
    stage = FakeComponent(
        "AxialStage",
        "Etapa principal",
        1.4,
        0.0,
        [
            FakeComponent("NoseCone", "Ojiva", 0.18, 0.0),
            FakeComponent(
                "BodyTube",
                "Cuerpo",
                1.0,
                0.18,
                [FakeComponent("RailButton", "Rail Button alto", 0.0, 0.5)],
            ),
            FakeComponent("BodyTube", "Aletas", 0.2, 1.18, fins_tube_children),
            FakeComponent("BodyTube", "Body Tube", 0.02, 1.38),
        ],
    )
    return FakeComponent("Rocket", "MT1", 1.4, 0.0, [stage])


def _positions(rocket):
    elements = process_elements_position(rocket, {}, 0.0, 0.0, top_position=0)
    return {e["name"]: e["position"] for e in elements.values()}


def test_fin_set_position_ignores_preceding_siblings():
    positions = _positions(_mt1_rocket(_fins_tube_children()))

    assert positions["Aletas de forma libre"] == pytest.approx(1.18)
    assert positions["Rail Button alto"] == pytest.approx(0.68)
    assert positions["Rail Button medio"] == pytest.approx(1.245)
    assert positions["Rail Button bajo"] == pytest.approx(1.365)
    assert positions["Portamotor"] == pytest.approx(1.194)
    assert positions["cono superior motor"] == pytest.approx(1.164)


def test_stage_level_components_keep_their_stacked_positions():
    positions = _positions(_mt1_rocket(_fins_tube_children()))

    assert positions["Ojiva"] == pytest.approx(0.0)
    assert positions["Cuerpo"] == pytest.approx(0.18)
    assert positions["Aletas"] == pytest.approx(1.18)
    assert positions["Body Tube"] == pytest.approx(1.38)


def test_sibling_order_does_not_change_positions():
    reordered = list(reversed(_fins_tube_children()))

    assert _positions(_mt1_rocket(reordered)) == pytest.approx(
        _positions(_mt1_rocket(_fins_tube_children()))
    )


def test_nested_subcomponent_is_measured_from_its_own_parent():
    ring = FakeComponent("CenteringRing", "Centering ring", 0.003, 0.05)
    mount = FakeComponent("InnerTube", "Motor mount", 0.186, 0.014, [ring])
    children = [FakeComponent("RailButton", "Rail Button bajo", 0.0, 0.185), mount]

    positions = _positions(_mt1_rocket(children))

    assert positions["Centering ring"] == pytest.approx(1.18 + 0.014 + 0.05)
