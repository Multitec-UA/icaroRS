"""Storage-seam contract tests for serialize_flight — T-44.

TDD: T-44 (RED) written first; T-45 (GREEN) cleans up any stale local-disk
assumptions in serialize.py.

These tests guard the boundary between serialize.py and the Storage seam:
1. serialize_flight MUST write all outputs under the caller-supplied run_dir.
2. All output files MUST land in a flat directory: run_dir / run_id / *.
3. The returned plot_urls MUST be URL strings (``/api/results/...``), not
   filesystem paths — the Storage adapter is the authoritative source.
4. The returned dict MUST NOT contain any local filesystem path.
5. series.json and result.json MUST be written to the staging dir so the
   router can upload them via Storage.upload_dir after lock release.

Req: Design §serialize.py, REQ-02.2, REQ-07.1.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from icaro_api.serialize import serialize_flight
from tests.fakes import FakeFlight


# ---------------------------------------------------------------------------
# Staging directory contract
# ---------------------------------------------------------------------------


class TestSerializeWritesToStagingDir:
    def test_all_files_under_run_dir_subdirectory(self, tmp_path):
        """Every output file must be inside run_dir/run_id/ (the staging sub-dir)."""
        run_id = "stage-001"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])

        staging = tmp_path / run_id
        assert staging.is_dir(), f"Staging dir {staging} must exist"

        # No files must be written directly to tmp_path (only inside sub-dir)
        direct_files = [p for p in tmp_path.iterdir() if p.is_file()]
        assert direct_files == [], (
            f"serialize_flight must not write directly to run_dir root: {direct_files}"
        )

    def test_result_json_in_staging_subdir(self, tmp_path):
        """result.json must be at run_dir/run_id/result.json for Storage upload."""
        run_id = "stage-002"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])

        result_json = tmp_path / run_id / "result.json"
        assert result_json.exists(), "result.json must be present in staging dir"

    def test_series_json_in_staging_subdir(self, tmp_path):
        """series.json must be at run_dir/run_id/series.json for Storage upload."""
        run_id = "stage-003"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])

        series_json = tmp_path / run_id / "series.json"
        assert series_json.exists(), "series.json must be present in staging dir"

    def test_pngs_in_staging_subdir(self, tmp_path):
        """All PNG files must be inside run_dir/run_id/ (flat — no nested dirs)."""
        run_id = "stage-004"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])

        staging = tmp_path / run_id
        pngs = list(staging.glob("*.png"))
        assert len(pngs) >= 3, f"Expected at least 3 PNGs in staging dir, got {pngs}"

        # Verify no PNGs outside the staging dir
        outside_pngs = list(tmp_path.glob("*.png"))
        assert outside_pngs == [], (
            f"No PNGs should be written outside the run subdirectory: {outside_pngs}"
        )

    def test_no_output_above_run_dir(self, tmp_path):
        """serialize_flight must not write anything above the run_dir argument."""
        run_id = "stage-005"
        # Place run_dir inside a deeper path so we can check the parent
        run_dir = tmp_path / "staging"
        run_dir.mkdir()

        serialize_flight(FakeFlight(), run_dir, run_id, [])

        # tmp_path itself (parent of run_dir) must be empty
        direct_in_tmp = [p for p in tmp_path.iterdir() if p.is_file()]
        assert direct_in_tmp == [], (
            f"Nothing should be written above run_dir: {direct_in_tmp}"
        )


# ---------------------------------------------------------------------------
# Return value contract — no filesystem paths in the response
# ---------------------------------------------------------------------------


class TestSerializeReturnValueContract:
    def test_plot_urls_are_url_strings_not_paths(self, tmp_path):
        """plot_urls must be URL strings, not filesystem paths."""
        result = serialize_flight(FakeFlight(), tmp_path, "url-001", [])
        for url in result["plot_urls"]:
            assert url.startswith("/api/results/"), (
                f"plot_url must be a URL, not a filesystem path: {url!r}"
            )
            assert not url.startswith("/tmp"), (
                f"plot_url must not expose a temp path: {url!r}"
            )
            assert str(tmp_path) not in url, (
                f"plot_url must not contain the local run_dir path: {url!r}"
            )

    def test_result_dict_contains_no_filesystem_paths(self, tmp_path):
        """The returned dict must not expose any local filesystem path in any value."""
        run_id = "url-002"
        result = serialize_flight(FakeFlight(), tmp_path, run_id, [])

        # Flatten all string values in the result dict for inspection
        all_strings: list[str] = []
        for val in result.values():
            if isinstance(val, str):
                all_strings.append(val)
            elif isinstance(val, list):
                all_strings.extend(v for v in val if isinstance(v, str))
            elif isinstance(val, dict):
                all_strings.extend(v for v in val.values() if isinstance(v, str))

        for s in all_strings:
            assert str(tmp_path) not in s, (
                f"Result value must not expose local path {tmp_path}: found in {s!r}"
            )

    def test_result_json_content_matches_returned_dict(self, tmp_path):
        """result.json on disk must match the dict returned to the caller."""
        run_id = "url-003"
        result = serialize_flight(FakeFlight(), tmp_path, run_id, [])

        result_json_path = tmp_path / run_id / "result.json"
        on_disk = json.loads(result_json_path.read_text())

        assert on_disk["run_id"] == result["run_id"]
        assert on_disk["scalars"] == result["scalars"]
        assert on_disk["warnings"] == result["warnings"]

    def test_staging_dir_is_uploadable_as_flat_set(self, tmp_path):
        """All staging files must be directly under run_dir/run_id/ (flat — no subfolders).

        This ensures Storage.upload_dir can upload them all with a single
        prefix call without needing recursive subdirectory handling.
        """
        run_id = "url-004"
        serialize_flight(FakeFlight(), tmp_path, run_id, [])

        staging = tmp_path / run_id
        nested_dirs = [p for p in staging.iterdir() if p.is_dir()]
        assert nested_dirs == [], (
            f"Staging dir must be flat (no subdirectories): {nested_dirs}"
        )
