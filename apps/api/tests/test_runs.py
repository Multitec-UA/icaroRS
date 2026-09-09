"""Tests for run-id helpers and service dependency factories.

TDD: T-06 (RED) written first; T-07 (GREEN) confirms make_run_id is already
an opaque slug.  T-05 wiring tested via test_config_adapter_selection.py.
Req: REQ-01.1 — export_id MUST NOT contain filesystem path segments.
"""

from __future__ import annotations

import pytest


class TestMakeRunId:
    def test_run_id_contains_no_slash(self):
        """make_run_id() must return a string with no '/' characters."""
        from icaro_api.runs import make_run_id

        run_id = make_run_id()
        assert "/" not in run_id, f"run_id contains '/': {run_id!r}"

    def test_run_id_contains_no_tmp(self):
        """make_run_id() must not contain 'tmp' (not a filesystem path)."""
        from icaro_api.runs import make_run_id

        run_id = make_run_id()
        assert "tmp" not in run_id.lower(), f"run_id contains 'tmp': {run_id!r}"

    def test_run_id_is_not_absolute_path(self):
        """make_run_id() must not start with '/' (not an absolute path)."""
        from icaro_api.runs import make_run_id

        run_id = make_run_id()
        assert not run_id.startswith("/"), f"run_id starts with '/': {run_id!r}"

    def test_run_id_is_nonempty_string(self):
        """make_run_id() must return a non-empty string."""
        from icaro_api.runs import make_run_id

        run_id = make_run_id()
        assert isinstance(run_id, str)
        assert len(run_id) > 0

    def test_run_id_is_url_safe(self):
        """make_run_id() must contain only URL-safe characters (letters, digits, -, _)."""
        import re

        from icaro_api.runs import make_run_id

        run_id = make_run_id()
        assert re.match(r'^[A-Za-z0-9_\-]+$', run_id), (
            f"run_id contains non-URL-safe characters: {run_id!r}"
        )

    def test_two_consecutive_ids_are_unique(self):
        """make_run_id() must not return the same value twice in a row."""
        from icaro_api.runs import make_run_id

        id1 = make_run_id()
        id2 = make_run_id()
        assert id1 != id2


class TestGetDbSingleton:
    """T-BUG-01 — get_db() must return a PROCESS-WIDE singleton InMemoryDb.

    Regression guard for the per-request bug: get_db() was returning a fresh
    InMemoryDb() on every call so records saved in one request were invisible
    to the next.

    Isolation: reset runs._inmemory_db = None in teardown so the singleton
    does not leak into other tests (route tests all override via
    dependency_overrides so they are unaffected regardless).
    """

    def setup_method(self):
        """Reset singleton before each test for isolation."""
        import icaro_api.runs as runs
        runs._inmemory_db = None

    def teardown_method(self):
        """Reset singleton after each test so the suite stays clean."""
        import icaro_api.runs as runs
        runs._inmemory_db = None

    def test_get_db_returns_same_instance(self):
        """Two calls with the same default settings must return the identical object."""
        from icaro_api.config import Settings
        from icaro_api.runs import get_db

        settings = Settings()
        db1 = get_db(settings)
        db2 = get_db(settings)
        assert db1 is db2, (
            "get_db() returned different InMemoryDb instances — "
            "cross-request state will be lost"
        )

    def test_get_db_persists_record_across_calls(self):
        """A record saved via one get_db() call must be visible via a subsequent call.

        This directly proves the cross-request persistence that was broken by
        the per-request InMemoryDb() instantiation.
        """
        from datetime import datetime, timezone

        from icaro_api.config import Settings
        from icaro_api.runs import get_db
        from icaro_api.services.db import RocketRecord

        settings = Settings()

        # Simulate a /api/convert request: save a record through one db handle.
        db_write = get_db(settings)
        rec = RocketRecord(
            rocket_id="test-rocket-singleton",
            name="Test Rocket",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            created_by="test",
            org_id="org-test",
            export_prefix="exports/test-rocket-singleton/",
            gcs_ref="exports/test-rocket-singleton/",
        )
        db_write.save_rocket(rec, org_id="org-test")

        # Simulate a /api/rockets request: retrieve via a separate get_db() call.
        db_read = get_db(settings)
        result = db_read.get_rocket("test-rocket-singleton", org_id="org-test")
        assert result is not None, (
            "Record saved via one get_db() call was invisible to a subsequent "
            "get_db() call — singleton not working"
        )
        assert result.name == "Test Rocket"
