import contextlib
import io
import json
import subprocess
import sys
from pathlib import Path

import pytest


@pytest.mark.parametrize(
    "expected_results_file, fixture",
    [
        (
            "examples/ProjetoJupiter--Valetudo--2019/parameters.json",
            "valetudo_settings",
        ),
        ("examples/NDRT--Rocket--2020/parameters.json", "ndrt_settings"),
        ("examples/EPFL--BellaLui--2020/parameters.json", "epfl_settings"),
        (
            "examples/MT1--2026/v1.5.0/parameters.json",
            "mt1_settings",
        ),
    ],
)
def test_ork_extractor(expected_results_file, fixture, request):
    # load the expected results
    with open(expected_results_file, "r") as f:
        expected_results = json.load(f)

    # get the settings from the fixture
    settings = request.getfixturevalue(fixture)

    # assert all the keys are equal; ``body_segments`` is an optional block
    # added after these expected files were stored
    optional = {"body_segments"}
    assert set(settings.keys()) - optional == set(expected_results.keys()) - optional
    assert isinstance(settings["body_segments"], list)

    # remove sensitive keys
    settings, expected_results = remove_sensitive_keys(settings, expected_results)

    # assert all the values are equal
    # for key in settings.keys():
    #     if isinstance(settings[key], dict):
    #         for sub_key in settings[key].keys():
    #             assert settings[key][sub_key] == expected_results[key][sub_key]
    #     else:
    #         assert settings[key] == expected_results[key]


def remove_sensitive_keys(settings, expected):
    """Remove sensitive keys from the settings and expected_results dicts. This
    is important to avoid problems with the paths to the files that are saved
    when the tests are run.

    Parameters
    ----------
    settings : dict
        The
    expected : dict
        _description_

    Returns
    -------
    (settings, expected) : tuple of dicts
        _description_
    """
    settings["id"].pop("filepath")
    settings["id"].pop("comment")
    settings["id"].pop("designer")
    settings["rocket"].pop("drag_curve")
    settings["motors"].pop("thrust_source")

    expected["id"].pop("filepath")
    expected["id"].pop("comment")
    expected["id"].pop("designer")
    expected["rocket"].pop("drag_curve")
    expected["motors"].pop("thrust_source")
    return settings, expected


def test_mt1_has_freeform_fins(mt1_settings):
    """MT1 v1.5.0 contains freeform fins — verify extraction correctness.

    This locks the no-negation correctness: the first shape point is anchored
    at the root leading edge (0.0, 0.0) and subsequent x-values are POSITIVE
    (OpenRocket stores finpoints with +x toward the tail, matching RocketPy's
    add_free_form_fins convention — no transform is applied).
    """
    assert "freeform_fins" in mt1_settings, (
        "freeform_fins key must be present in extracted settings"
    )

    freeform = mt1_settings["freeform_fins"]
    assert isinstance(freeform, dict), "freeform_fins must be a dict"
    assert len(freeform) > 0, "MT1 must have at least one freeform fin set"

    # JSON round-trip converts int keys to strings
    key = "0" if "0" in freeform else 0
    fin = freeform[key]

    assert "shape_points" in fin, "freeform fin entry must contain shape_points"
    shape = fin["shape_points"]
    assert len(shape) >= 3, "MT1 freeform fin must have at least 3 shape points"

    # First point anchored at root leading edge (origin)
    assert shape[0] == [0.0, 0.0], (
        f"First shape point must be [0.0, 0.0] (root leading edge), got {shape[0]}"
    )

    # Second point x must be POSITIVE — locks no-negation correctness
    # MT1 v1.5.0 second point is [0.15, 0.07]
    assert shape[1][0] > 0, (
        f"Second shape point x must be positive (no negation), got {shape[1]}"
    )


MT1_V170_ORK = Path(__file__).parent / "MT1--2026" / "v1.7.0" / "MT1-v1.7.0.ork"
MT1_V171_ORK = Path(__file__).parent / "MT1--2026" / "v1.7.1" / "MT1-v1.7.1.ork"


def _convert_in_subprocess(ork_path, output):
    """Convert in a fresh process: conftest already shut its JVM."""
    subprocess.run(
        [
            sys.executable,
            "-I",
            "-c",
            "import sys; from rocketserializer.cli import cli; cli(sys.argv[1:])",
            "ork2json",
            "--filepath",
            str(ork_path),
            "--output",
            str(output),
            "--ork_jar",
            str(Path("OpenRocket-23.09.jar").resolve()),
        ],
        check=True,
        capture_output=True,
    )
    return output


@pytest.fixture(scope="module")
def mt1_v170_export(tmp_path_factory):
    return _convert_in_subprocess(MT1_V170_ORK, tmp_path_factory.mktemp("mt1_v170"))


@pytest.fixture(scope="module")
def mt1_v171_export(tmp_path_factory):
    return _convert_in_subprocess(MT1_V171_ORK, tmp_path_factory.mktemp("mt1_v171"))


def test_mt1_v170_fins_ignore_preceding_subcomponents(mt1_v170_export):
    """The fin set sits after two rail buttons and two inner tubes inside the
    "Aletas" tube (1.18-1.38 m). Its leading edge is at 1.18 m, as in
    OpenRocket; the old converter stacked the inner tube lengths and put it at
    1.396 m, inflating the rail-exit stability margin to 7.54 cal."""
    params = json.loads((mt1_v170_export / "parameters.json").read_text())

    fins = params["freeform_fins"]["0"]
    assert fins["position"] == pytest.approx(1.18)
    assert params["rail_buttons"]["upper_position"] == pytest.approx(1.245)
    assert params["rail_buttons"]["lower_position"] == pytest.approx(1.365)


def test_mt1_v170_rail_exit_margin_close_to_openrocket(mt1_v170_export):
    """OpenRocket's stored simulation reports 3.08 cal at rail exit."""
    simulation = pytest.importorskip("icaro.simulation")

    with contextlib.redirect_stdout(io.StringIO()):
        flight, *_ = simulation.build_nominal_flight(mt1_v170_export, None)

    assert flight.out_of_rail_stability_margin < 5


def test_mt1_v171_body_segments(mt1_v171_export):
    """The four stage-level components, in axial order; the inner tubes inside
    "Cuerpo" and "Aletas" are not part of the outer body."""
    params = json.loads((mt1_v171_export / "parameters.json").read_text())

    expected = [
        ("nosecone", "Ojiva", 0.0, 0.18, 0.0, 0.03),
        ("bodytube", "Cuerpo", 0.18, 1.0, 0.03, 0.03),
        ("bodytube", "Aletas", 1.18, 0.2, 0.03, 0.03),
        ("bodytube", "Body Tube", 1.38, 0.02, 0.03, 0.03),
    ]
    segments = params["body_segments"]
    assert [(s["kind"], s["name"]) for s in segments] == [e[:2] for e in expected]
    for segment, (*_, position, length, fore, aft) in zip(segments, expected):
        assert segment["position"] == pytest.approx(position, abs=1e-9)
        assert segment["length"] == pytest.approx(length, abs=1e-9)
        assert segment["fore_radius"] == pytest.approx(fore, abs=1e-9)
        assert segment["aft_radius"] == pytest.approx(aft, abs=1e-9)


def test_mt1_v171_keeps_the_existing_blocks(mt1_v171_export, mt1_v170_export):
    """``body_segments`` is additive: the rest of the export has the same keys
    as before and the same component positions as v1.7.0."""
    v171 = json.loads((mt1_v171_export / "parameters.json").read_text())
    v170 = json.loads((mt1_v170_export / "parameters.json").read_text())

    assert set(v171) == set(v170)
    assert v171["freeform_fins"]["0"]["position"] == pytest.approx(1.18)
    assert v171["nosecones"]["position"] == pytest.approx(0.0)
    assert v171["rail_buttons"] == v170["rail_buttons"]
