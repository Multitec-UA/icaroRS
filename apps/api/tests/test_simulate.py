"""Tests for POST /api/simulate with Storage/Db injection.

TDD: T-10 (RED) written first, T-11 (GREEN) wires the router.
Req: REQ-01.3 (storage seam resolves export_id)
     REQ-07.1 (GCS upload after lock release)
     REQ-07.3 (Db write after lock release)

Lock-ordering note (T-10 fork)
-------------------------------
The lock-then-upload ordering assertion uses a call_log list populated by
side_effect mocks. This approach is reliable and synchronous; it avoids
spawning threads for what is fundamentally a sequential code-path assertion.
The threading-event approach (noted in the tasks) would only be necessary if
simulate.py became async — deferred until then.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import pytest
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import InMemoryDb, SimRecord
from icaro_api.services.storage import LocalFsStorage

_TEST_SESSION_COOKIE = "test-session-token"


def _fake_verify_identity(cookie: str) -> dict:
    if cookie != _TEST_SESSION_COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": "test-org"}


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


def _fake_results(run_id: str = "fake-sim-001") -> dict:
    return {
        "run_id": run_id,
        "scalars": {"apogee_m": 3000.0},
        "plot_urls": [f"/api/results/{run_id}/plots/trajectory_3d.png"],
        "warnings": [],
    }


def _make_client(storage, db):
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db, get_storage

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, raise_server_exceptions=True)


def _valid_body(export_id: str) -> dict:
    return {
        "export_id": export_id,
        "scenario": {
            "site": {"latitude": 0.0, "longitude": 0.0},
            "atmosphere": {"model": "standard_atmosphere"},
        },
    }


class TestSimulateStorageSeam:
    def test_storage_download_dir_called_with_exports_prefix(self, tmp_path):
        """REQ-01.3: simulate must resolve export via storage.download_dir, not Path.exists."""
        storage = MagicMock(spec=LocalFsStorage)
        # download_dir creates the dest dir — simulate must call it
        storage.download_dir.return_value = None
        db = InMemoryDb()
        client = _make_client(storage, db)

        export_id = "20260605T120000Z-abcd1234"

        from tests.fakes import FakeFlight

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=_fake_results()),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code == 200
        storage.download_dir.assert_called_once()
        call_args = storage.download_dir.call_args
        prefix = call_args[0][0] if call_args[0] else call_args[1].get("prefix", "")
        assert prefix == f"exports/{export_id}/", (
            f"Expected prefix 'exports/{export_id}/', got: {prefix!r}"
        )

    def test_storage_upload_dir_called_after_simulation(self, tmp_path):
        """REQ-02.2 + REQ-07.1: storage.upload_dir must be called with results/ prefix
        after simulation completes (outside lock)."""
        storage = MagicMock(spec=LocalFsStorage)
        storage.download_dir.return_value = None
        db = InMemoryDb()
        client = _make_client(storage, db)

        export_id = "20260605T120000Z-abcd1234"
        run_id = "fake-sim-001"

        from tests.fakes import FakeFlight

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=_fake_results(run_id)),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code == 200
        storage.upload_dir.assert_called_once()
        call_args = storage.upload_dir.call_args
        prefix = call_args[0][0] if call_args[0] else call_args[1].get("prefix", "")
        assert prefix.startswith("results/"), (
            f"upload_dir prefix must start with 'results/': {prefix!r}"
        )

    def test_upload_dir_called_after_lock_released(self, tmp_path):
        """REQ-07.1: GCS upload must happen AFTER _SIMULATE_LOCK is released.

        Assertion strategy: capture _SIMULATE_LOCK.locked() at the moment
        upload_dir is called. If the lock is still held (True) at that point,
        the implementation is wrong. The lock must be free (False) when upload runs.

        Note: Python 3.14's threading.Lock has read-only C-level methods so we
        cannot patch .release directly. We use .locked() as the observable proxy.
        """
        from icaro_api.simulate_lock import _SIMULATE_LOCK

        lock_state_at_upload: list[bool] = []

        storage = MagicMock(spec=LocalFsStorage)
        storage.download_dir.return_value = None

        def recording_upload(*args, **kwargs):
            # If upload runs while lock is held, locked() == True (wrong).
            lock_state_at_upload.append(_SIMULATE_LOCK.locked())

        storage.upload_dir.side_effect = recording_upload
        db = InMemoryDb()

        client = _make_client(storage, db)
        export_id = "20260605T120000Z-abcd5678"

        from tests.fakes import FakeFlight

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=_fake_results()),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code == 200
        assert lock_state_at_upload, "upload_dir was never called"
        assert not lock_state_at_upload[0], (
            "upload_dir was called while _SIMULATE_LOCK was still held "
            f"(locked={lock_state_at_upload[0]})"
        )

    def test_db_save_simulation_called_after_lock(self, tmp_path):
        """REQ-07.3: Db write must happen after lock release.

        Same .locked() probe strategy as test_upload_dir_called_after_lock_released.
        """
        from icaro_api.simulate_lock import _SIMULATE_LOCK

        lock_state_at_db_save: list[bool] = []

        storage = MagicMock(spec=LocalFsStorage)
        storage.download_dir.return_value = None
        storage.upload_dir.return_value = None

        db = MagicMock(spec=InMemoryDb)

        def recording_save_sim(rec, org_id):
            lock_state_at_db_save.append(_SIMULATE_LOCK.locked())

        db.save_simulation.side_effect = recording_save_sim

        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app
        from icaro_api.runs import get_db, get_storage

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings()
        app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
        app.dependency_overrides[get_storage] = lambda: storage
        app.dependency_overrides[get_db] = lambda: db
        client = TestClient(app, raise_server_exceptions=True)

        export_id = "20260605T120000Z-abcd9999"

        from tests.fakes import FakeFlight

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=_fake_results()),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code == 200
        assert lock_state_at_db_save, "db.save_simulation was never called"
        assert not lock_state_at_db_save[0], (
            "db.save_simulation called while _SIMULATE_LOCK was still held "
            f"(locked={lock_state_at_db_save[0]})"
        )

    def test_no_path_exists_check_on_export_id(self, tmp_path):
        """REQ-01.2: simulate must NOT call Path(export_id).exists() for a logical id.

        A logical id like '20260605T120000Z-abc' must not 404 just because
        there's no local directory with that name.  The storage seam handles
        resolution.
        """
        storage = MagicMock(spec=LocalFsStorage)
        storage.download_dir.return_value = None
        db = InMemoryDb()
        client = _make_client(storage, db)

        # This id has no corresponding local directory.
        export_id = "20260605T120000Z-nonexistent"

        from tests.fakes import FakeFlight

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=_fake_results()),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        # Must succeed — the storage seam fetches the export, no local dir needed.
        assert resp.status_code == 200


class TestPersistenceFailureIsolation:
    """T-14/T-15 — REQ-07.4: persistence failures after lock MUST NOT fail the simulate response."""

    def _client_with_failing_upload(self):
        """Build a client where storage.upload_dir raises."""
        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app
        from icaro_api.runs import get_db, get_storage
        from unittest.mock import MagicMock

        storage = MagicMock(spec=LocalFsStorage)
        storage.download_dir.return_value = None
        storage.upload_dir.side_effect = OSError("GCS unavailable")
        db = InMemoryDb()

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings()
        app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
        app.dependency_overrides[get_storage] = lambda: storage
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app, raise_server_exceptions=False), db

    def test_upload_failure_returns_200(self, tmp_path):
        """REQ-07.4: storage.upload_dir raising must not cause a 5xx response."""
        from tests.fakes import FakeFlight

        client, db = self._client_with_failing_upload()
        export_id = "20260605T120000Z-failupload"

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=_fake_results()),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code == 200, (
            f"Expected 200 even with upload failure, got {resp.status_code}: {resp.text}"
        )

    def test_upload_failure_still_returns_valid_payload(self, tmp_path):
        """REQ-07.4: response payload must be the simulation result despite upload failure."""
        from tests.fakes import FakeFlight

        client, db = self._client_with_failing_upload()
        export_id = "20260605T120000Z-payloadcheck"
        fake_res = _fake_results()
        fake_res["scalars"] = {"apogee_m": 5000.0}

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=fake_res),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code == 200
        data = resp.json()
        assert data.get("scalars", {}).get("apogee_m") == 5000.0

    def test_db_failure_returns_200(self, tmp_path):
        """REQ-07.4: db.save_simulation raising must not cause a 5xx response."""
        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app
        from icaro_api.runs import get_db, get_storage
        from unittest.mock import MagicMock
        from tests.fakes import FakeFlight

        storage = MagicMock(spec=LocalFsStorage)
        storage.download_dir.return_value = None
        storage.upload_dir.return_value = None

        db = MagicMock(spec=InMemoryDb)
        db.save_simulation.side_effect = RuntimeError("Firestore connection refused")

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings()
        app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
        app.dependency_overrides[get_storage] = lambda: storage
        app.dependency_overrides[get_db] = lambda: db
        client = TestClient(app, raise_server_exceptions=False)

        export_id = "20260605T120000Z-dbfail"

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=_fake_results()),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code == 200, (
            f"Expected 200 even with db failure, got {resp.status_code}: {resp.text}"
        )


class TestErrorSimulationRecord:
    """T-16/T-17 — REQ-03.2 failure path: even on simulation error, db.save_simulation
    must be called with status='error' and warnings containing the error message."""

    def _client_with_failing_simulate(self, error_msg: str):
        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app
        from icaro_api.runs import get_db, get_storage
        from unittest.mock import MagicMock

        storage = MagicMock(spec=LocalFsStorage)
        storage.download_dir.return_value = None

        db = MagicMock(spec=InMemoryDb)

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings()
        app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
        app.dependency_overrides[get_storage] = lambda: storage
        app.dependency_overrides[get_db] = lambda: db
        return TestClient(app, raise_server_exceptions=False), db, storage

    def test_failed_simulation_returns_error_status(self, tmp_path):
        """REQ-03.2: POST /api/simulate that errors must return 4xx/5xx."""
        error_msg = "RocketPy exploded"
        client, db, storage = self._client_with_failing_simulate(error_msg)
        export_id = "20260605T120000Z-simfail01"

        with patch(
            "icaro_api.routers.simulate.simulate_from_export",
            side_effect=RuntimeError(error_msg),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code >= 400, (
            f"Expected 4xx/5xx on simulation error, got {resp.status_code}"
        )

    def test_db_save_called_with_status_error(self, tmp_path):
        """REQ-03.2: db.save_simulation must be called with status='error' on failure."""
        error_msg = "RocketPy integration failure"
        client, db, storage = self._client_with_failing_simulate(error_msg)
        export_id = "20260605T120000Z-simfail02"

        with patch(
            "icaro_api.routers.simulate.simulate_from_export",
            side_effect=RuntimeError(error_msg),
        ):
            client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        db.save_simulation.assert_called_once()
        saved_rec = db.save_simulation.call_args[0][0]
        assert isinstance(saved_rec, SimRecord)
        assert saved_rec.status == "error", (
            f"Expected status='error', got {saved_rec.status!r}"
        )

    def test_db_save_error_warnings_contain_error_message(self, tmp_path):
        """REQ-03.2: SimRecord.warnings must contain the error description."""
        error_msg = "Chute deployment failed"
        client, db, storage = self._client_with_failing_simulate(error_msg)
        export_id = "20260605T120000Z-simfail03"

        with patch(
            "icaro_api.routers.simulate.simulate_from_export",
            side_effect=RuntimeError(error_msg),
        ):
            client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        db.save_simulation.assert_called_once()
        saved_rec = db.save_simulation.call_args[0][0]
        assert any(error_msg in w for w in saved_rec.warnings), (
            f"Expected error message in warnings; got {saved_rec.warnings!r}"
        )

    def test_db_save_error_has_correct_rocket_id(self, tmp_path):
        """REQ-03.2: SimRecord.rocket_id must match the export_id even on failure."""
        error_msg = "Physics error"
        client, db, storage = self._client_with_failing_simulate(error_msg)
        export_id = "20260605T120000Z-rocketid1"

        with patch(
            "icaro_api.routers.simulate.simulate_from_export",
            side_effect=RuntimeError(error_msg),
        ):
            client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        db.save_simulation.assert_called_once()
        saved_rec = db.save_simulation.call_args[0][0]
        assert saved_rec.rocket_id == export_id


class TestSimulateDbRecord:
    def test_db_save_simulation_called_with_sim_record(self, tmp_path):
        """REQ-03.2: simulate must save a SimRecord with correct fields."""
        storage = MagicMock(spec=LocalFsStorage)
        storage.download_dir.return_value = None
        storage.upload_dir.return_value = None
        db = MagicMock(spec=InMemoryDb)

        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app
        from icaro_api.runs import get_db, get_storage

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings()
        app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
        app.dependency_overrides[get_storage] = lambda: storage
        app.dependency_overrides[get_db] = lambda: db
        client = TestClient(app, raise_server_exceptions=True)

        export_id = "20260605T120000Z-rocketid"
        sim_run_id = "fake-sim-002"
        fake_res = _fake_results(sim_run_id)
        fake_res["scalars"] = {"apogee_m": 4200.0}

        from tests.fakes import FakeFlight

        with (
            patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
            patch("icaro_api.routers.simulate.serialize_flight", return_value=fake_res),
        ):
            resp = client.post(
                "/api/simulate",
                json=_valid_body(export_id),
                headers=_auth(),
            )

        assert resp.status_code == 200
        db.save_simulation.assert_called_once()
        saved_rec = db.save_simulation.call_args[0][0]
        assert isinstance(saved_rec, SimRecord)
        assert saved_rec.rocket_id == export_id
        assert saved_rec.status == "done"
        assert saved_rec.scalars.get("apogee_m") == 4200.0
