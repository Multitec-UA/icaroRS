"""Tests for GET /api/results/{run_id} and GET /api/results/{run_id}/plots/{name}.png.

TDD: written BEFORE routers/results.py is implemented (RED phase).
Tasks: 1.33.
Coverage: file serving, 404 for missing, forward-compat job-status shape.

Batch-2 note: results.py was migrated to use the Storage seam (T-13).
Tests that previously relied on a local ``results_dir`` now inject a
``LocalFsStorage`` instance so the router can call ``open_blob``.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import Db, InMemoryDb, SimRecord
from icaro_api.services.storage import LocalFsStorage

_TEST_SESSION_COOKIE = "test-session-token"
_ORG = "test-org"  # matches _fake_verify_identity's org_id claim below
_OTHER_ORG = "other-org"


def _fake_verify_identity(cookie: str) -> dict:
    if cookie != _TEST_SESSION_COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": _ORG}


def _sim(run_id: str, org_id: str = _ORG) -> SimRecord:
    """A SimRecord matching the blob layout these tests seed in Storage —
    result_prefix (issue #45) is what routers/results.py derives keys from."""
    return SimRecord(
        simulation_id=run_id,
        rocket_id="r-any",
        scenario={},
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        created_by="test",
        org_id=org_id,
        status="done",
        result_prefix=f"results/{run_id}/",
    )


def _make_client_with_storage(storage: Any, tmp_path, db: Db | None = None) -> TestClient:
    """Create a TestClient that injects *storage* (and optionally *db*) as deps.

    *db* defaults to an empty InMemoryDb — a run with no matching SimRecord
    404s on the ownership check (issue #44) regardless of what's in Storage.
    """
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db, get_storage

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_db] = lambda: db if db is not None else InMemoryDb()
    return TestClient(app, raise_server_exceptions=True)


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


# ---------------------------------------------------------------------------
# GET /api/results/{run_id}
# ---------------------------------------------------------------------------


class TestResultsEndpoint:
    def test_returns_result_json_if_exists(self, tmp_path):
        """result.json found in Storage → 200 with forward-compat shape {run_id, status, result}."""
        run_id = "20260529T000000Z-abc12345"
        payload = {
            "run_id": run_id,
            "scalars": {"apogee_m": 1000.0},
            "plot_urls": [],
            "warnings": [],
        }
        # Build LocalFsStorage with the blob pre-seeded at the correct key.
        storage = LocalFsStorage(tmp_path)
        blob_dir = tmp_path / f"results/{run_id}"
        blob_dir.mkdir(parents=True)
        (blob_dir / "result.json").write_text(json.dumps(payload))

        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client_with_storage(storage, tmp_path, db=db)
        resp = client.get(f"/api/results/{run_id}", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        # Forward-compat shape (RG-9.7, design §11)
        assert data["run_id"] == run_id
        assert data["status"] == "done"
        assert "result" in data

    def test_returns_404_if_run_missing(self, tmp_path):
        """Missing run_id → 404."""
        storage = LocalFsStorage(tmp_path)
        client = _make_client_with_storage(storage, tmp_path)
        resp = client.get("/api/results/nonexistent-run-id", headers=_auth())
        assert resp.status_code == 404

    def test_returns_404_for_another_orgs_run(self, tmp_path):
        """Issue #44: a run owned by another org must 404, not 200 — even
        though the blob exists in Storage."""
        run_id = "20260529T000000Z-theirs001"
        payload = {"run_id": run_id, "scalars": {}, "plot_urls": [], "warnings": []}
        storage = LocalFsStorage(tmp_path)
        blob_dir = tmp_path / f"results/{run_id}"
        blob_dir.mkdir(parents=True)
        (blob_dir / "result.json").write_text(json.dumps(payload))

        db = InMemoryDb()
        db.save_simulation(_sim(run_id, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        client = _make_client_with_storage(storage, tmp_path, db=db)
        resp = client.get(f"/api/results/{run_id}", headers=_auth())

        assert resp.status_code == 404

    def test_returns_401_without_auth(self, tmp_path):
        storage = LocalFsStorage(tmp_path)
        client = _make_client_with_storage(storage, tmp_path)
        resp = client.get("/api/results/some-run-id")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/results/{run_id}/plots/{name}.png
# ---------------------------------------------------------------------------

# Minimal PNG bytes (1x1 white pixel)
_TINY_PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


class TestPlotsEndpoint:
    def test_serves_existing_png(self, tmp_path):
        """Existing PNG in Storage → 200 with image/png content-type."""
        run_id = "20260529T000000Z-png12345"
        storage = LocalFsStorage(tmp_path)
        blob_dir = tmp_path / f"results/{run_id}"
        blob_dir.mkdir(parents=True)
        (blob_dir / "trajectory_3d.png").write_bytes(_TINY_PNG)

        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client_with_storage(storage, tmp_path, db=db)
        resp = client.get(f"/api/results/{run_id}/plots/trajectory_3d.png", headers=_auth())

        assert resp.status_code == 200
        assert "image" in resp.headers.get("content-type", "")

    def test_returns_404_for_another_orgs_plot(self, tmp_path):
        """Issue #44: PNGs get the same ownership check as the JSON endpoints —
        they're the artifact most likely to be linked/embedded directly."""
        run_id = "20260529T000000Z-theirspng"
        storage = LocalFsStorage(tmp_path)
        blob_dir = tmp_path / f"results/{run_id}"
        blob_dir.mkdir(parents=True)
        (blob_dir / "trajectory_3d.png").write_bytes(_TINY_PNG)

        db = InMemoryDb()
        db.save_simulation(_sim(run_id, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        client = _make_client_with_storage(storage, tmp_path, db=db)
        resp = client.get(f"/api/results/{run_id}/plots/trajectory_3d.png", headers=_auth())

        assert resp.status_code == 404

    def test_returns_404_for_missing_plot(self, tmp_path):
        """Owned run, but the plot blob itself is missing → 404."""
        run_id = "20260529T000000Z-nopng123"
        storage = LocalFsStorage(tmp_path)
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client_with_storage(storage, tmp_path, db=db)
        resp = client.get(f"/api/results/{run_id}/plots/nonexistent.png", headers=_auth())
        assert resp.status_code == 404

    def test_returns_404_for_missing_run(self, tmp_path):
        """Missing run_id → 404."""
        storage = LocalFsStorage(tmp_path)
        client = _make_client_with_storage(storage, tmp_path)
        resp = client.get("/api/results/nonexistent-run/plots/traj.png", headers=_auth())
        assert resp.status_code == 404

    def test_returns_401_without_auth(self, tmp_path):
        storage = LocalFsStorage(tmp_path)
        client = _make_client_with_storage(storage, tmp_path)
        resp = client.get("/api/results/some-run/plots/traj.png")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/results/{run_id}/series  (issue #11 — interactive charts data)
# ---------------------------------------------------------------------------


def _storage_client(tmp_path, db: Db | None = None) -> TestClient:
    storage = LocalFsStorage(tmp_path)
    return _make_client_with_storage(storage, tmp_path, db=db)


class TestSeriesEndpoint:
    def test_returns_series_json_if_exists(self, tmp_path):
        """series.json blob in Storage → 200 with the time-series payload."""
        run_id = "20260529T000000Z-series01"
        storage = LocalFsStorage(tmp_path)
        blob_dir = tmp_path / f"results/{run_id}"
        blob_dir.mkdir(parents=True)
        payload = {
            "t": [0.0, 1.0, 2.0],
            "altitude": [0.0, 30.0, 60.0],
            "speed": [25.0, 25.0, 25.0],
            "mach": [0.0, 0.05, 0.1],
            "acceleration": [9.81, 9.81, 9.81],
            "path3d": [[0.0, 0.0, 0.0], [1.5, 2.0, 30.0], [3.0, 4.0, 60.0]],
        }
        (blob_dir / "series.json").write_text(json.dumps(payload))

        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client_with_storage(storage, tmp_path, db=db)
        resp = client.get(f"/api/results/{run_id}/series", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        assert data["t"] == [0.0, 1.0, 2.0]
        assert data["path3d"][1] == [1.5, 2.0, 30.0]

    def test_returns_404_when_series_missing(self, tmp_path):
        """Owned run, but no series blob → 404 so the client falls back to PNG plots."""
        run_id = "20260529T000000Z-noseries"
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _storage_client(tmp_path, db=db)
        resp = client.get(f"/api/results/{run_id}/series", headers=_auth())
        assert resp.status_code == 404

    def test_returns_404_when_run_missing(self, tmp_path):
        client = _storage_client(tmp_path)
        resp = client.get("/api/results/does-not-exist/series", headers=_auth())
        assert resp.status_code == 404

    def test_returns_404_for_another_orgs_series(self, tmp_path):
        """Issue #44: a series owned by another org must 404, not 200."""
        run_id = "20260529T000000Z-theirseries"
        storage = LocalFsStorage(tmp_path)
        blob_dir = tmp_path / f"results/{run_id}"
        blob_dir.mkdir(parents=True)
        (blob_dir / "series.json").write_text(json.dumps({"t": [0.0]}))

        db = InMemoryDb()
        db.save_simulation(_sim(run_id, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        client = _make_client_with_storage(storage, tmp_path, db=db)
        resp = client.get(f"/api/results/{run_id}/series", headers=_auth())

        assert resp.status_code == 404

    def test_returns_401_without_auth(self, tmp_path):
        client = _storage_client(tmp_path)
        resp = client.get("/api/results/some-run/series")
        assert resp.status_code == 401
