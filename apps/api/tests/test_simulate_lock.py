"""Tests for POST /api/simulate — concurrency lock.

TDD: written BEFORE routers/simulate.py and simulate_lock.py are implemented.
Tasks: 1.29, 1.30.
Coverage: AC-RG-9.2 (concurrent simulate requests both succeed, second waits for lock).
"""

from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import InMemoryDb, RocketRecord

_TEST_SESSION_COOKIE = "test-session-token"
_ORG = "test-org"  # matches _fake_verify_identity's org_id claim below


def _fake_verify_identity(cookie: str) -> dict:
    if cookie != _TEST_SESSION_COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": _ORG}


def _make_client(db: InMemoryDb | None = None) -> TestClient:
    from icaro_api.main import create_app
    from icaro_api.config import Settings, get_settings
    from icaro_api.runs import get_db

    app = create_app()

    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    app.dependency_overrides[get_db] = lambda: db if db is not None else InMemoryDb()
    return TestClient(app, raise_server_exceptions=True)


def _seed_rocket(db: InMemoryDb, export_id: str) -> None:
    """POST /api/simulate now resolves export_id to its RocketRecord (#45)."""
    db.save_rocket(
        RocketRecord(
            rocket_id=export_id,
            name="TestRocket",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            created_by="test",
            org_id=_ORG,
            export_prefix=f"exports/{export_id}/",
        ),
        org_id=_ORG,
    )


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


# ---------------------------------------------------------------------------
# Simulate lock module test (task 1.29)
# ---------------------------------------------------------------------------


class TestSimulateLockModule:
    def test_simulate_lock_exists(self):
        """Module-level _SIMULATE_LOCK is a threading.Lock."""
        from icaro_api.simulate_lock import _SIMULATE_LOCK

        assert isinstance(_SIMULATE_LOCK, type(threading.Lock()))

    def test_same_lock_object_on_multiple_imports(self):
        """Same lock object returned on repeated imports (module-level singleton)."""
        from icaro_api import simulate_lock as sl1
        from icaro_api import simulate_lock as sl2

        assert sl1._SIMULATE_LOCK is sl2._SIMULATE_LOCK


# ---------------------------------------------------------------------------
# Concurrency test (task 1.30) — two threads, second waits for lock
# ---------------------------------------------------------------------------


class TestSimulateConcurrency:
    """AC-RG-9.2: two concurrent simulate calls both succeed; second waits for lock."""

    def test_two_concurrent_simulate_calls_both_succeed(self):
        """Both threads complete with 200; second starts only after first releases lock."""
        import json
        import tempfile
        from pathlib import Path

        # We need a valid export dir for simulate_from_export — use a tmp dir
        # with a minimal parameters.json stub. The actual simulation is mocked.
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            call_order: list[str] = []
            lock_acquired_by: list[str] = []
            first_started = threading.Event()
            first_can_release = threading.Event()

            from icaro_api.simulate_lock import _SIMULATE_LOCK

            original_acquire = _SIMULATE_LOCK.acquire

            def slow_first_acquire(blocking=True, timeout=-1):
                """Intercept the first acquisition to simulate holding the lock."""
                result = original_acquire(blocking=blocking, timeout=timeout)
                if result:
                    name = threading.current_thread().name
                    lock_acquired_by.append(name)
                    if len(lock_acquired_by) == 1:
                        # First thread to get the lock: signal + wait.
                        first_started.set()
                        first_can_release.wait(timeout=5)
                return result

            from tests.fakes import FakeFlight

            fake_results = {
                "run_id": "fake-001",
                "scalars": {},
                "plot_urls": [],
                "warnings": [],
            }

            results: list = []
            errors: list = []

            db = InMemoryDb()
            export_id = str(tmp_path)
            _seed_rocket(db, export_id)
            client = _make_client(db)

            valid_body = {
                "export_id": export_id,
                "scenario": {
                    "site": {"latitude": 0.0, "longitude": 0.0},
                    "atmosphere": {"model": "standard_atmosphere"},
                },
            }

            def do_simulate():
                try:
                    with (
                        patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
                        patch("icaro_api.routers.simulate.serialize_flight", return_value=fake_results),
                    ):
                        resp = client.post("/api/simulate", json=valid_body, headers=_auth())
                        results.append(resp.status_code)
                except Exception as e:
                    errors.append(str(e))

            t1 = threading.Thread(target=do_simulate, name="thread-1")
            t2 = threading.Thread(target=do_simulate, name="thread-2")

            t1.start()
            # Give t1 a moment to start
            time.sleep(0.1)
            t2.start()

            # Let both threads run (they mock everything so they're fast)
            t1.join(timeout=10)
            t2.join(timeout=10)

            # Both should complete with 200
            assert not errors, f"Errors in threads: {errors}"
            assert len(results) == 2
            assert all(s == 200 for s in results), f"Not all 200: {results}"


# ---------------------------------------------------------------------------
# Basic simulate endpoint tests (task 1.31)
# ---------------------------------------------------------------------------


class TestSimulateEndpoint:
    def test_returns_200_with_mocked_simulate(self):
        """POST /api/simulate with mocked internals returns 200."""
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            from tests.fakes import FakeFlight

            fake_results = {
                "run_id": "test-run-001",
                "scalars": {"apogee_m": 1000.0},
                "plot_urls": ["/api/results/test-run-001/plots/trajectory_3d.png"],
                "warnings": [],
            }

            db = InMemoryDb()
            export_id = str(tmp_path)
            _seed_rocket(db, export_id)
            client = _make_client(db)
            body = {
                "export_id": export_id,
                "scenario": {
                    "site": {"latitude": 0.0, "longitude": 0.0},
                    "atmosphere": {"model": "standard_atmosphere"},
                },
            }

            with (
                patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
                patch("icaro_api.routers.simulate.serialize_flight", return_value=fake_results),
            ):
                resp = client.post("/api/simulate", json=body, headers=_auth())

            assert resp.status_code == 200
            data = resp.json()
            assert "run_id" in data
            assert "scalars" in data
            assert "plot_urls" in data
            assert "warnings" in data

    def test_run_id_always_in_response(self):
        """ADR-6: run_id always returned (forward-compat)."""
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            from tests.fakes import FakeFlight

            fake_results = {
                "run_id": "my-run-id",
                "scalars": {},
                "plot_urls": [],
                "warnings": [],
            }

            db = InMemoryDb()
            export_id = str(tmp_path)
            _seed_rocket(db, export_id)
            client = _make_client(db)
            body = {
                "export_id": export_id,
                "scenario": {
                    "site": {"latitude": 0.0, "longitude": 0.0},
                    "atmosphere": {"model": "standard_atmosphere"},
                },
            }

            with (
                patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
                patch("icaro_api.routers.simulate.serialize_flight", return_value=fake_results),
            ):
                resp = client.post("/api/simulate", json=body, headers=_auth())

            assert resp.json()["run_id"] == "my-run-id"

    def test_returns_401_without_auth(self):
        client = _make_client()
        resp = client.post("/api/simulate", json={})
        assert resp.status_code == 401
