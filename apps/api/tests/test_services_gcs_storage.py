"""Contract tests for GcsStorage adapter — T-40.

TDD: T-40 (RED) written first; T-41 (GREEN) fixes any GcsStorage bugs.
Req: Design §Testing Strategy — GCS adapter contract, regression guard.

All tests mock ``google.cloud.storage.Client`` — zero live GCP dependency.
The mock is injected by patching the import inside GcsStorage.__init__.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest

from icaro_api.services.storage import GcsStorage


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_gcs_client():
    """Patch google.cloud.storage.Client; return (mock_client, mock_bucket)."""
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_client.bucket.return_value = mock_bucket

    with patch.dict(
        "sys.modules",
        {
            "google": MagicMock(),
            "google.cloud": MagicMock(),
            "google.cloud.storage": MagicMock(Client=MagicMock(return_value=mock_client)),
            "google.cloud.exceptions": MagicMock(),
        },
    ):
        yield mock_client, mock_bucket


@pytest.fixture()
def gcs(mock_gcs_client, tmp_path):
    """Return a GcsStorage instance wired to the mock client/bucket."""
    _mock_client, mock_bucket = mock_gcs_client

    mock_gcs_module = MagicMock()
    mock_gcs_module.Client.return_value = _mock_client

    with patch("icaro_api.services.storage.GcsStorage.__init__") as mock_init:
        # Bypass __init__ and set attributes directly
        mock_init.return_value = None
        storage = GcsStorage.__new__(GcsStorage)
        storage._client = _mock_client
        storage._bucket = mock_bucket
        yield storage, mock_bucket


# ---------------------------------------------------------------------------
# upload_dir contract
# ---------------------------------------------------------------------------


class TestGcsStorageUploadDir:
    def test_uploads_each_file_as_blob(self, gcs, tmp_path):
        """upload_dir must call blob.upload_from_filename for each file."""
        storage, mock_bucket = gcs

        src = tmp_path / "src"
        src.mkdir()
        (src / "parameters.json").write_text('{"name": "TestRocket"}')
        (src / "drag_curve.csv").write_text("x,y\n1,2\n")

        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob

        storage.upload_dir("exports/r1/", src)

        # blob() called once per file
        assert mock_bucket.blob.call_count == 2
        # upload_from_filename called once per file
        assert mock_blob.upload_from_filename.call_count == 2

    def test_blob_key_is_prefix_plus_filename(self, gcs, tmp_path):
        """Blob key must be {prefix}{filename} (no extra path separator)."""
        storage, mock_bucket = gcs

        src = tmp_path / "src"
        src.mkdir()
        (src / "result.json").write_text("{}")

        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob

        storage.upload_dir("results/sim1/", src)

        mock_bucket.blob.assert_called_once_with("results/sim1/result.json")

    def test_upload_skips_subdirectories(self, gcs, tmp_path):
        """upload_dir must only upload top-level files (flat prefix, no nesting)."""
        storage, mock_bucket = gcs

        src = tmp_path / "src"
        src.mkdir()
        (src / "file.txt").write_text("top")
        subdir = src / "sub"
        subdir.mkdir()
        (subdir / "nested.txt").write_text("nested")

        mock_blob = MagicMock()
        mock_bucket.blob.return_value = mock_blob

        storage.upload_dir("prefix/", src)

        # Only 1 file (top-level), not 2
        assert mock_bucket.blob.call_count == 1
        mock_bucket.blob.assert_called_once_with("prefix/file.txt")

    def test_upload_empty_directory_is_noop(self, gcs, tmp_path):
        """upload_dir on empty dir must not call blob() at all."""
        storage, mock_bucket = gcs

        src = tmp_path / "empty"
        src.mkdir()

        storage.upload_dir("prefix/empty/", src)

        mock_bucket.blob.assert_not_called()


# ---------------------------------------------------------------------------
# download_dir contract
# ---------------------------------------------------------------------------


class TestGcsStorageDownloadDir:
    def test_downloads_blobs_into_dest(self, gcs, tmp_path):
        """download_dir must create dest and write each blob's bytes into it."""
        storage, mock_bucket = gcs

        dest = tmp_path / "dest"

        # Simulate two blobs under the prefix
        blob1 = MagicMock()
        blob1.name = "results/s1/result.json"
        blob1.download_as_bytes.return_value = b'{"apogee": 3000}'

        blob2 = MagicMock()
        blob2.name = "results/s1/series.json"
        blob2.download_as_bytes.return_value = b'{"t": []}'

        mock_bucket.list_blobs.return_value = [blob1, blob2]

        storage.download_dir("results/s1/", dest)

        assert dest.exists()
        assert (dest / "result.json").read_bytes() == b'{"apogee": 3000}'
        assert (dest / "series.json").read_bytes() == b'{"t": []}'

    def test_download_uses_correct_prefix_arg(self, gcs, tmp_path):
        """list_blobs must be called with the exact prefix string."""
        storage, mock_bucket = gcs

        mock_bucket.list_blobs.return_value = []
        dest = tmp_path / "dest"

        storage.download_dir("exports/r42/", dest)

        mock_bucket.list_blobs.assert_called_once_with(prefix="exports/r42/")

    def test_download_strips_prefix_from_filename(self, gcs, tmp_path):
        """Filename in dest must be the part AFTER the prefix."""
        storage, mock_bucket = gcs

        dest = tmp_path / "dest"
        prefix = "exports/r1/"

        blob = MagicMock()
        blob.name = f"{prefix}parameters.json"  # full key
        blob.download_as_bytes.return_value = b"{}"

        mock_bucket.list_blobs.return_value = [blob]

        storage.download_dir(prefix, dest)

        # Must NOT create "exports/r1/parameters.json" — only "parameters.json"
        assert (dest / "parameters.json").exists()
        assert not (dest / "exports").exists()

    def test_download_skips_blob_with_empty_suffix(self, gcs, tmp_path):
        """A blob whose name equals the prefix exactly (no filename) is skipped."""
        storage, mock_bucket = gcs

        dest = tmp_path / "dest"
        prefix = "exports/r1/"

        # Blob name == prefix (no trailing filename — GCS can return the prefix itself)
        blob_prefix_only = MagicMock()
        blob_prefix_only.name = prefix
        blob_prefix_only.download_as_bytes.return_value = b""

        blob_real = MagicMock()
        blob_real.name = f"{prefix}parameters.json"
        blob_real.download_as_bytes.return_value = b'{"ok": true}'

        mock_bucket.list_blobs.return_value = [blob_prefix_only, blob_real]

        storage.download_dir(prefix, dest)

        # Only parameters.json must be written; empty suffix blob is skipped
        files = list(dest.iterdir())
        assert len(files) == 1
        assert files[0].name == "parameters.json"

    def test_download_creates_dest_when_missing(self, gcs, tmp_path):
        """download_dir creates dest directory if it does not exist."""
        storage, mock_bucket = gcs

        dest = tmp_path / "new" / "nested" / "dest"
        assert not dest.exists()

        mock_bucket.list_blobs.return_value = []

        storage.download_dir("any/prefix/", dest)

        assert dest.exists()


# ---------------------------------------------------------------------------
# open_blob contract
# ---------------------------------------------------------------------------


class TestGcsStorageOpenBlob:
    def test_returns_bytes_for_existing_blob(self, gcs):
        """open_blob must return the bytes downloaded from GCS."""
        storage, mock_bucket = gcs

        mock_blob = MagicMock()
        mock_blob.download_as_bytes.return_value = b'{"run_id": "abc"}'
        mock_bucket.blob.return_value = mock_blob

        result = storage.open_blob("results/sim1/result.json")

        assert result == b'{"run_id": "abc"}'
        mock_bucket.blob.assert_called_once_with("results/sim1/result.json")

    def test_raises_keyerror_when_blob_missing(self, gcs):
        """open_blob must raise KeyError (not NotFound) when the blob is absent.

        Strategy: create a custom NotFound class, make download_as_bytes raise it,
        then patch google.cloud.exceptions inside the module so the except clause
        catches it and re-raises as KeyError.
        """
        storage, mock_bucket = gcs

        # Create a custom NotFound type that the real open_blob will catch.
        class FakeNotFound(Exception):
            pass

        mock_blob = MagicMock()
        mock_blob.download_as_bytes.side_effect = FakeNotFound("blob not found")
        mock_bucket.blob.return_value = mock_blob

        # Patch google.cloud.exceptions so the except clause in open_blob sees
        # our FakeNotFound as the NotFound exception to catch.
        fake_exceptions_module = MagicMock()
        fake_exceptions_module.NotFound = FakeNotFound

        with patch.dict(
            "sys.modules",
            {"google.cloud.exceptions": fake_exceptions_module},
        ):
            with pytest.raises(KeyError):
                storage.open_blob("results/sim1/missing.json")


# ---------------------------------------------------------------------------
# exists contract
# ---------------------------------------------------------------------------


class TestGcsStorageExists:
    def test_returns_true_when_blobs_found(self, gcs):
        """exists returns True when list_blobs returns at least one blob."""
        storage, mock_bucket = gcs

        mock_bucket.list_blobs.return_value = [MagicMock()]

        assert storage.exists("exports/r1/") is True
        mock_bucket.list_blobs.assert_called_once_with(
            prefix="exports/r1/", max_results=1
        )

    def test_returns_false_when_no_blobs(self, gcs):
        """exists returns False when list_blobs returns an empty list."""
        storage, mock_bucket = gcs

        mock_bucket.list_blobs.return_value = []

        assert storage.exists("exports/nonexistent/") is False

    def test_uses_max_results_1_for_efficiency(self, gcs):
        """exists must pass max_results=1 to avoid fetching all blobs."""
        storage, mock_bucket = gcs

        mock_bucket.list_blobs.return_value = []

        storage.exists("some/prefix/")

        mock_bucket.list_blobs.assert_called_once_with(
            prefix="some/prefix/", max_results=1
        )
