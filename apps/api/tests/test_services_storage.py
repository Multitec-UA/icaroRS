"""Contract tests for LocalFsStorage adapter — T-27.

TDD: T-27 (RED) written first; T-28 (GREEN) fixes any LocalFsStorage bugs.
Req: Design §Testing Strategy — adapter contract, regression guard.

All tests use tmp_path (pytest built-in fixture) — zero GCP dependency.
GcsStorage contract is NOT tested here (unit-only per task scope; GCP calls
would require a mock — deferred to production adapter tests in Step 10).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from icaro_api.services.storage import LocalFsStorage


# ---------------------------------------------------------------------------
# upload_dir contract
# ---------------------------------------------------------------------------


class TestLocalFsStorageUploadDir:
    def test_uploads_files_under_prefix(self, tmp_path):
        """upload_dir copies every file in local_dir to {root}/{prefix}{filename}."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        src = tmp_path / "src"
        src.mkdir()
        (src / "a.json").write_text('{"hello": "world"}')
        (src / "b.csv").write_text("x,y\n1,2\n")

        storage.upload_dir("exports/r1/", src)

        assert (root / "exports/r1/a.json").exists()
        assert (root / "exports/r1/b.csv").exists()
        assert (root / "exports/r1/a.json").read_text() == '{"hello": "world"}'

    def test_upload_creates_prefix_directory(self, tmp_path):
        """upload_dir creates the prefix directory if it does not exist."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        src = tmp_path / "src"
        src.mkdir()
        (src / "file.txt").write_text("content")

        storage.upload_dir("deep/nested/prefix/", src)

        assert (root / "deep/nested/prefix/file.txt").exists()

    def test_upload_skips_subdirectories(self, tmp_path):
        """upload_dir copies only top-level files, not subdirectories (flat prefix)."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        src = tmp_path / "src"
        src.mkdir()
        (src / "file.txt").write_text("top-level")
        subdir = src / "sub"
        subdir.mkdir()
        (subdir / "nested.txt").write_text("nested")

        storage.upload_dir("prefix/", src)

        assert (root / "prefix/file.txt").exists()
        # The subdirectory itself must not appear as a file under the prefix
        assert not (root / "prefix/sub").is_file()

    def test_upload_empty_directory_is_noop(self, tmp_path):
        """upload_dir on an empty dir creates the prefix dir but adds no blobs."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        src = tmp_path / "empty_src"
        src.mkdir()

        storage.upload_dir("prefix/empty/", src)

        prefix_dir = root / "prefix/empty"
        # Prefix directory may or may not be created; no files should be present.
        if prefix_dir.exists():
            files = list(prefix_dir.iterdir())
            assert files == [], f"Expected no files, got {files}"


# ---------------------------------------------------------------------------
# download_dir contract
# ---------------------------------------------------------------------------


class TestLocalFsStorageDownloadDir:
    def test_download_recreates_files(self, tmp_path):
        """download_dir copies blobs under prefix into dest."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        # Pre-seed blobs
        prefix_dir = root / "results/s1"
        prefix_dir.mkdir(parents=True)
        (prefix_dir / "result.json").write_text('{"apogee": 3000}')
        (prefix_dir / "series.json").write_text('{"t": []}')

        dest = tmp_path / "dest"
        storage.download_dir("results/s1/", dest)

        assert (dest / "result.json").exists()
        assert (dest / "series.json").exists()
        assert json.loads((dest / "result.json").read_text())["apogee"] == 3000

    def test_download_creates_dest_dir(self, tmp_path):
        """download_dir creates dest if it does not exist."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        prefix_dir = root / "exports/r1"
        prefix_dir.mkdir(parents=True)
        (prefix_dir / "parameters.json").write_text("{}")

        dest = tmp_path / "new_dest" / "sub"
        assert not dest.exists()

        storage.download_dir("exports/r1/", dest)

        assert dest.exists()
        assert (dest / "parameters.json").exists()

    def test_download_missing_prefix_is_noop(self, tmp_path):
        """download_dir on a missing prefix is a no-op (no error)."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        dest = tmp_path / "dest"
        dest.mkdir()

        # Must not raise
        storage.download_dir("nonexistent/prefix/", dest)

        # dest is empty — no files were created
        assert list(dest.iterdir()) == []


# ---------------------------------------------------------------------------
# open_blob contract
# ---------------------------------------------------------------------------


class TestLocalFsStorageOpenBlob:
    def test_returns_blob_bytes(self, tmp_path):
        """open_blob returns the raw bytes of the blob at key."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        (root / "results" / "s1").mkdir(parents=True)
        data = b'{"apogee": 1234}'
        (root / "results/s1/result.json").write_bytes(data)

        result = storage.open_blob("results/s1/result.json")
        assert result == data

    def test_raises_keyerror_for_missing_blob(self, tmp_path):
        """open_blob raises KeyError when the blob does not exist."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        with pytest.raises(KeyError):
            storage.open_blob("nonexistent/key.json")

    def test_open_blob_png(self, tmp_path):
        """open_blob works for binary files (PNGs)."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 20  # minimal PNG-like data
        (root / "results" / "s1").mkdir(parents=True)
        (root / "results/s1/traj.png").write_bytes(png_bytes)

        result = storage.open_blob("results/s1/traj.png")
        assert result == png_bytes


# ---------------------------------------------------------------------------
# exists contract
# ---------------------------------------------------------------------------


class TestLocalFsStorageExists:
    def test_returns_true_when_prefix_has_files(self, tmp_path):
        """exists returns True when at least one file exists under prefix."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        prefix_dir = root / "exports/r1"
        prefix_dir.mkdir(parents=True)
        (prefix_dir / "parameters.json").write_text("{}")

        assert storage.exists("exports/r1/") is True

    def test_returns_false_for_missing_prefix(self, tmp_path):
        """exists returns False when the prefix directory does not exist."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        assert storage.exists("exports/nonexistent/") is False

    def test_returns_false_for_empty_prefix_dir(self, tmp_path):
        """exists returns False when the prefix directory exists but is empty."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        (root / "exports/empty").mkdir(parents=True)

        assert storage.exists("exports/empty/") is False

    def test_returns_false_for_prefix_with_only_subdirs(self, tmp_path):
        """exists returns False when the prefix has only subdirectories, no files."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        subdir = root / "exports/r-subs" / "subdir"
        subdir.mkdir(parents=True)

        # No files directly under exports/r-subs/ — only a subdirectory.
        assert storage.exists("exports/r-subs/") is False


# ---------------------------------------------------------------------------
# Round-trip: upload → download → open
# ---------------------------------------------------------------------------


class TestLocalFsStorageRoundTrip:
    def test_upload_then_download(self, tmp_path):
        """Full round-trip: upload from src, download to dest, verify contents."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        src = tmp_path / "src"
        src.mkdir()
        (src / "a.json").write_text('{"val": 42}')
        (src / "b.txt").write_text("hello")

        storage.upload_dir("prefix/run1/", src)

        dest = tmp_path / "dest"
        storage.download_dir("prefix/run1/", dest)

        assert (dest / "a.json").read_text() == '{"val": 42}'
        assert (dest / "b.txt").read_text() == "hello"

    def test_upload_then_open_blob(self, tmp_path):
        """After upload, open_blob must return the uploaded bytes."""
        root = tmp_path / "store"
        storage = LocalFsStorage(root)

        src = tmp_path / "src"
        src.mkdir()
        data = b'{"key": "value"}'
        (src / "result.json").write_bytes(data)

        storage.upload_dir("results/s2/", src)

        result = storage.open_blob("results/s2/result.json")
        assert result == data
