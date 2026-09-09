"""Tests for config-driven adapter selection in get_storage() / get_db().

TDD phase: RED first (T-02), GREEN after T-05 wires get_storage/get_db.
Req: Design §Config, guard against silent prod fallback to LocalFs/InMemory.
"""

from __future__ import annotations

import pytest

from icaro_api.config import Settings


class TestStorageAdapterSelection:
    def test_get_storage_returns_local_fs_when_no_bucket(self):
        """get_storage() must return LocalFsStorage when gcs_bucket is None."""
        from icaro_api.runs import get_storage
        from icaro_api.services.storage import LocalFsStorage

        s = Settings(gcs_bucket=None)
        storage = get_storage(s)
        assert isinstance(storage, LocalFsStorage)

    def test_get_storage_returns_gcs_when_bucket_set(self):
        """get_storage() must return GcsStorage when gcs_bucket is set."""
        from unittest.mock import patch

        from icaro_api.runs import get_storage
        from icaro_api.services.storage import GcsStorage

        s = Settings(gcs_bucket="my-bucket")
        with patch("icaro_api.services.storage.GcsStorage.__init__", return_value=None):
            storage = get_storage(s)
        assert isinstance(storage, GcsStorage)

    def test_get_db_returns_in_memory_when_no_project(self):
        """get_db() must return InMemoryDb when firestore_project is None."""
        from icaro_api.runs import get_db
        from icaro_api.services.db import InMemoryDb

        s = Settings(firestore_project=None)
        db = get_db(s)
        assert isinstance(db, InMemoryDb)

    def test_get_db_returns_firestore_when_project_set(self):
        """get_db() must return FirestoreDb when firestore_project is set."""
        from unittest.mock import patch

        from icaro_api.runs import get_db
        from icaro_api.services.db import FirestoreDb

        s = Settings(firestore_project="my-gcp-project")
        with patch("icaro_api.services.db.FirestoreDb.__init__", return_value=None):
            db = get_db(s)
        assert isinstance(db, FirestoreDb)

    def test_local_storage_root_uses_results_dir(self, tmp_path):
        """LocalFsStorage returned by get_storage() must be rooted at results_dir."""
        from icaro_api.runs import get_storage
        from icaro_api.services.storage import LocalFsStorage

        s = Settings(gcs_bucket=None, results_dir=tmp_path)
        storage = get_storage(s)
        assert isinstance(storage, LocalFsStorage)
        # The root must be inside results_dir (blobs live under it)
        assert storage._root.is_relative_to(tmp_path) or storage._root == tmp_path

    def test_no_silent_prod_fallback_guard(self):
        """Canary: in-process get_storage() / get_db() with no env must be LocalFs/InMemory.

        This test exists so that if someone accidentally removes the None-check
        and always constructs GCS/Firestore adapters, the test suite catches it
        without needing GCP credentials.
        """
        from icaro_api.runs import get_db, get_storage
        from icaro_api.services.db import InMemoryDb
        from icaro_api.services.storage import LocalFsStorage

        s = Settings()  # gcs_bucket=None, firestore_project=None
        assert isinstance(get_storage(s), LocalFsStorage)
        assert isinstance(get_db(s), InMemoryDb)
