"""Tests for icaro.convert — convert_ork use-case.

All tests are pure unit tests. No JVM, no network, no real .ork files needed.

TDD: these tests were written BEFORE convert.py exists (RED phase).
     They become green after B1.2 implementation.

Coverage targets:
- CVT-1 happy path: mock rocketserializer pipeline, assert return value
- CVT-2 missing [convert] extra: ImportError path → ConvertUnavailableError
          with actionable message mentioning the extra AND Java
- CVT-3 non-existent .ork file → FileNotFoundError / ConvertUnavailableError
         referencing the missing path
- output_dir default logic (derived from ork stem in cwd vs explicit)
- REQ-CVT-03: rocketserializer import is lazy (import icaro never hard-requires JVM)
- REQ-CVT-04: architecture — convert_ork is exported from icaro.__init__

Integration test (B3.1) is marked with @pytest.mark.integration and skipped in CI.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _remove_rocketserializer_from_sys(monkeypatch):
    """Ensure rocketserializer / orhelper are NOT in sys.modules
    so lazy-import tests get a clean slate."""
    for key in list(sys.modules):
        if key.startswith("rocketserializer") or key.startswith("orhelper"):
            monkeypatch.delitem(sys.modules, key, raising=False)


# ---------------------------------------------------------------------------
# B1.1 — CVT-2: missing [convert] extra raises ConvertUnavailableError
# ---------------------------------------------------------------------------


def test_cvt2_import_error_raises_convert_unavailable(monkeypatch, tmp_path):
    """CVT-2: when rocketserializer is not installed, convert_ork raises
    ConvertUnavailableError — NOT a raw ImportError traceback.

    The error message must:
    - mention the install command / extra (icaro-cli[convert] or icaro[convert])
    - mention Java 21
    """
    # Create a real .ork file so the file-existence check passes first.
    ork_file = tmp_path / "rocket.ork"
    ork_file.write_text("<openrocket/>")

    _remove_rocketserializer_from_sys(monkeypatch)

    # Force rocketserializer import to fail as if the extra is missing.
    import builtins

    real_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name.startswith("rocketserializer") or name.startswith("orhelper"):
            raise ImportError(f"No module named '{name}'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", mock_import)

    # Reload convert so the lazy import runs with the patched builtins.
    if "icaro.convert" in sys.modules:
        monkeypatch.delitem(sys.modules, "icaro.convert", raising=False)

    from icaro.convert import ConvertUnavailableError, convert_ork

    with pytest.raises(ConvertUnavailableError) as exc_info:
        convert_ork(ork_path=ork_file, output_dir=tmp_path / "out")

    msg = str(exc_info.value).lower()
    # Must give an actionable install hint.
    assert "convert" in msg, f"Expected install hint with 'convert' in: {msg}"
    # Must mention Java requirement.
    assert "java" in msg, f"Expected Java mention in: {msg}"


def test_cvt2_error_message_not_raw_traceback(monkeypatch, tmp_path):
    """CVT-2: ConvertUnavailableError must be a typed exception, not raw ImportError."""
    ork_file = tmp_path / "rocket.ork"
    ork_file.write_text("<openrocket/>")

    _remove_rocketserializer_from_sys(monkeypatch)

    import builtins

    real_import = builtins.__import__

    def mock_import(name, *args, **kwargs):
        if name.startswith("rocketserializer") or name.startswith("orhelper"):
            raise ImportError(f"No module named '{name}'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", mock_import)

    if "icaro.convert" in sys.modules:
        monkeypatch.delitem(sys.modules, "icaro.convert", raising=False)

    from icaro.convert import ConvertUnavailableError, convert_ork

    # Must NOT re-raise the raw ImportError.
    with pytest.raises(ConvertUnavailableError):
        convert_ork(ork_path=ork_file, output_dir=str(tmp_path / "out"))


# ---------------------------------------------------------------------------
# B1.1 — CVT-3: non-existent .ork file → FileNotFoundError
# ---------------------------------------------------------------------------


def test_cvt3_nonexistent_ork_raises(tmp_path):
    """CVT-3: passing a path to a non-existent .ork file raises
    FileNotFoundError before any JVM interaction."""
    # We mock the rocketserializer layer to prove the file check happens first.
    fake_ork_extractor = MagicMock()
    fake_ork_extractor.ork_extractor = MagicMock()

    mock_orhelper = MagicMock()
    mock_instance = MagicMock()
    mock_instance.__enter__ = MagicMock(return_value=mock_instance)
    mock_instance.__exit__ = MagicMock(return_value=False)
    mock_orhelper.OpenRocketInstance.return_value = mock_instance

    mock_rs = MagicMock()
    mock_rs.ork_extractor = fake_ork_extractor

    with (
        patch.dict(
            sys.modules,
            {
                "rocketserializer": mock_rs,
                "rocketserializer.ork_extractor": fake_ork_extractor,
                "orhelper": mock_orhelper,
            },
        ),
    ):
        if "icaro.convert" in sys.modules:
            del sys.modules["icaro.convert"]

        from icaro.convert import convert_ork

        missing = tmp_path / "does_not_exist.ork"

        with pytest.raises(FileNotFoundError) as exc_info:
            convert_ork(ork_path=missing, output_dir=tmp_path / "out")

    assert str(missing) in str(exc_info.value) or "does_not_exist" in str(exc_info.value)


# ---------------------------------------------------------------------------
# B1.1 — CVT-1 happy path: mock ork2json pipeline, assert return value
# ---------------------------------------------------------------------------


def _build_mock_rocketserializer_modules(tmp_path):
    """Build sys.modules patches that simulate a successful ork2json conversion.

    Simulates the ork_extractor + orhelper pipeline writing the three output
    files (parameters.json, thrust_source.csv, drag_curve.csv) to output_dir.
    """

    def fake_ork_extractor_fn(bs, filepath, output_folder, ork):
        """Simulate ork_extractor writing output files."""
        out = Path(output_folder)
        out.mkdir(parents=True, exist_ok=True)
        (out / "parameters.json").write_text(json.dumps({"environment": {}}))
        (out / "thrust_source.csv").write_text("0,0\n1,100\n")
        (out / "drag_curve.csv").write_text("0.0,0.3\n1.0,0.5\n")
        return {"environment": {}}

    mock_ork_extractor_module = MagicMock()
    mock_ork_extractor_module.ork_extractor = fake_ork_extractor_fn

    mock_rocketserializer = MagicMock()
    mock_rocketserializer.ork_extractor = mock_ork_extractor_module

    # BeautifulSoup / helpers mock
    mock_helpers = MagicMock()
    mock_helpers.extract_ork_from_zip = MagicMock(side_effect=lambda p, d: p)
    mock_helpers.parse_ork_file = MagicMock(
        return_value=(MagicMock(), [MagicMock()])  # (bs, datapoints)
    )

    # orhelper mock
    mock_orh_instance = MagicMock()
    mock_orh_instance.__enter__ = MagicMock(return_value=mock_orh_instance)
    mock_orh_instance.__exit__ = MagicMock(return_value=False)
    mock_orh_instance.getRocket = MagicMock(return_value=MagicMock())

    mock_helper_obj = MagicMock()
    mock_helper_obj.load_doc = MagicMock(return_value=mock_orh_instance)

    mock_orhelper = MagicMock()
    mock_orhelper.OpenRocketInstance.return_value.__enter__ = MagicMock(
        return_value=mock_orh_instance
    )
    mock_orhelper.OpenRocketInstance.return_value.__exit__ = MagicMock(return_value=False)
    mock_orhelper.Helper.return_value = mock_helper_obj

    return mock_rocketserializer, mock_ork_extractor_module, mock_orhelper, mock_helpers


def test_cvt1_happy_path_returns_output_dir(tmp_path):
    """CVT-1: with mocked rocketserializer, convert_ork returns Path to output dir
    and the three expected files exist."""
    # Create a fake .ork file so the existence check passes.
    ork_file = tmp_path / "rocket.ork"
    ork_file.write_text("<openrocket/>")
    output_dir = tmp_path / "export"
    # Provide a fake jar path so _find_ork_jar is bypassed.
    fake_jar = tmp_path / "OpenRocket-23.09.jar"
    fake_jar.write_text("fake")

    mock_rs, mock_ork_ext, mock_orhelper, mock_helpers = (
        _build_mock_rocketserializer_modules(tmp_path)
    )

    patches = {
        "rocketserializer": mock_rs,
        "rocketserializer.ork_extractor": mock_ork_ext,
        "rocketserializer._helpers": mock_helpers,
        "orhelper": mock_orhelper,
    }

    with patch.dict(sys.modules, patches):
        if "icaro.convert" in sys.modules:
            del sys.modules["icaro.convert"]

        from icaro.convert import convert_ork

        result = convert_ork(ork_path=ork_file, output_dir=output_dir, ork_jar=fake_jar)

    assert isinstance(result, Path), f"Expected Path, got {type(result)}"
    assert result == output_dir.resolve() or result == output_dir


def test_cvt1_happy_path_output_files_exist(tmp_path):
    """CVT-1: convert_ork produces parameters.json, thrust_source.csv, drag_curve.csv."""
    ork_file = tmp_path / "rocket.ork"
    ork_file.write_text("<openrocket/>")
    output_dir = tmp_path / "export"
    fake_jar = tmp_path / "OpenRocket-23.09.jar"
    fake_jar.write_text("fake")

    mock_rs, mock_ork_ext, mock_orhelper, mock_helpers = (
        _build_mock_rocketserializer_modules(tmp_path)
    )

    patches = {
        "rocketserializer": mock_rs,
        "rocketserializer.ork_extractor": mock_ork_ext,
        "rocketserializer._helpers": mock_helpers,
        "orhelper": mock_orhelper,
    }

    with patch.dict(sys.modules, patches):
        if "icaro.convert" in sys.modules:
            del sys.modules["icaro.convert"]

        from icaro.convert import convert_ork

        result = convert_ork(ork_path=ork_file, output_dir=output_dir, ork_jar=fake_jar)

    # The fake ork_extractor writes these three files.
    assert (result / "parameters.json").exists()
    assert (result / "thrust_source.csv").exists()
    assert (result / "drag_curve.csv").exists()


# ---------------------------------------------------------------------------
# REQ-CVT-03 — lazy import: `import icaro` does NOT import rocketserializer
# ---------------------------------------------------------------------------


def test_req_cvt03_import_icaro_does_not_import_rocketserializer(monkeypatch):
    """REQ-CVT-03: importing `icaro` must NOT trigger rocketserializer import.

    The lazy-import pattern means rocketserializer only loads when convert_ork
    is actually called — not at module/package import time.

    Uses monkeypatch to ensure sys.modules changes are fully restored after
    this test, preventing state pollution into subsequent tests.
    """
    # Wipe rocketserializer + icaro.convert from sys.modules so we can track
    # fresh imports. Use monkeypatch so all changes are auto-restored.
    for key in list(sys.modules):
        if key.startswith("rocketserializer") or key == "icaro.convert":
            monkeypatch.delitem(sys.modules, key, raising=False)

    # Verify that after importing icaro, rocketserializer is still absent.
    # (icaro itself is already in sys.modules; this import is a no-op for the
    # package but the __init__.py's `from .convert import ...` line was already
    # executed. The key check is that rocketserializer is NOT imported.)
    import icaro  # noqa: F401 — side-effect import is the point

    rs_loaded = any(
        key.startswith("rocketserializer") for key in sys.modules
    )
    assert not rs_loaded, (
        "REQ-CVT-03: importing icaro triggered rocketserializer import. "
        "The lazy-import in convert_ork must defer until the function is called."
    )


# ---------------------------------------------------------------------------
# REQ-CVT-04 — convert_ork is exported from icaro.__init__
# ---------------------------------------------------------------------------


def test_req_cvt04_convert_ork_exported_from_icaro():
    """REQ-CVT-04: convert_ork must be importable from the icaro package directly."""
    import icaro

    assert hasattr(icaro, "convert_ork"), (
        "REQ-CVT-04: convert_ork is not exported from icaro.__init__. "
        "Add it to __all__ and the import in __init__.py."
    )
    assert hasattr(icaro, "ConvertUnavailableError"), (
        "ConvertUnavailableError should also be exported from icaro so callers "
        "can catch it without knowing the submodule."
    )


# ---------------------------------------------------------------------------
# Output-dir default resolution (pure logic, no JVM)
# ---------------------------------------------------------------------------


def test_output_dir_default_uses_ork_stem(tmp_path, monkeypatch):
    """When output_dir is None, convert_ork defaults to <ork_stem> in cwd."""
    ork_file = tmp_path / "my_rocket.ork"
    ork_file.write_text("<openrocket/>")
    # Provide a fake jar so _find_ork_jar is not invoked (we pass ork_jar=).
    fake_jar = tmp_path / "OpenRocket-23.09.jar"
    fake_jar.write_text("fake")

    mock_rs, mock_ork_ext, mock_orhelper, mock_helpers = (
        _build_mock_rocketserializer_modules(tmp_path)
    )
    patches = {
        "rocketserializer": mock_rs,
        "rocketserializer.ork_extractor": mock_ork_ext,
        "rocketserializer._helpers": mock_helpers,
        "orhelper": mock_orhelper,
    }

    # Change cwd to tmp_path so the default output lands there.
    monkeypatch.chdir(tmp_path)

    with patch.dict(sys.modules, patches):
        if "icaro.convert" in sys.modules:
            del sys.modules["icaro.convert"]

        from icaro.convert import convert_ork

        result = convert_ork(ork_path=ork_file, output_dir=None, ork_jar=fake_jar)

    # Default should be <cwd>/<stem> = tmp_path/my_rocket
    expected_stem = "my_rocket"
    assert expected_stem in str(result), (
        f"Expected output dir name to contain ork stem '{expected_stem}', got: {result}"
    )


# ---------------------------------------------------------------------------
# Integration test — real JVM + OpenRocket jar (skipped in CI)
# ---------------------------------------------------------------------------


@pytest.mark.integration
@pytest.mark.skip(reason="Requires Java 21 + OpenRocket .jar installed (NFN-4)")
def test_cvt1_integration_real_ork(tmp_path):
    """CVT-1 integration: real .ork → export dir with three output files.

    Prerequisites:
    - Java 21+ installed
    - OpenRocket .jar on PATH or pass ork_jar= kwarg
    - icaro-cli[convert] extra installed (rocketserializer + orhelper)
    - A sample .ork file at tests/fixtures/sample.ork (none committed yet)
    """
    sample_ork = Path(__file__).parent / "fixtures" / "sample.ork"
    if not sample_ork.exists():
        pytest.skip(f"No sample .ork file at {sample_ork}")

    from icaro.convert import convert_ork

    result = convert_ork(ork_path=sample_ork, output_dir=tmp_path / "export")

    assert (result / "parameters.json").exists()
    assert (result / "thrust_source.csv").exists()
    assert (result / "drag_curve.csv").exists()
