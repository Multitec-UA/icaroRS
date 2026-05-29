import json

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

    # assert all the keys are equal
    assert set(settings.keys()) == set(expected_results.keys())

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
