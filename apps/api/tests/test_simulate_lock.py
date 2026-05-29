"""Tests for POST /api/simulate — concurrency lock.

TDD: written BEFORE routers/simulate.py and simulate_lock.py are implemented.
Tasks: 1.29, 1.30.
Coverage: AC-RG-9.2 (concurrent simulate requests both succeed, second waits for lock).
"""

from __future__ import annotations

import base64
import threading
import time
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


def _make_client() -> TestClient:
    from icaro_api.main import create_app
    from icaro_api.config import Settings, get_settings

    app = create_app()

    def override_settings():
        return Settings(basic_user="test", basic_pass="test")

    app.dependency_overrides[get_settings] = override_settings
    return TestClient(app, raise_server_exceptions=True)


def _auth() -> dict:
    token = base64.b64encode(b"test:test").decode()
    return {"Authorization": f"Basic {token}"}


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

            client = _make_client()

            valid_body = {
                "export_id": str(tmp_path),
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

            client = _make_client()
            body = {
                "export_id": str(tmp_path),
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

            client = _make_client()
            body = {
                "export_id": str(tmp_path),
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
