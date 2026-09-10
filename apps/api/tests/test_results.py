"""Tests for results endpoints via Storage seam — T-12 / T-13.

TDD: T-12 (RED) written first; T-13 (GREEN) wires results.py to Storage.
Req: REQ-02.4 (result.json via Storage), REQ-02.5 (PNGs via Storage),
     REQ-02.6 (series.json via Storage).

Strategy
--------
Inject a fake Storage that holds blobs in a dict so tests run without any
filesystem or GCS dependency.  The results router must call
``storage.open_blob(key)`` to serve data and ``storage.exists(prefix)``
(or equivalent) to return 404 for missing resources.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from datetime import datetime, timezone

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

# Minimal 1x1 white PNG bytes
_TINY_PNG: bytes = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x02\x00\x00\x00\x90wS\xde"
    b"\x00\x00\x00\x0cIDATx\x9cc\xf8\x0f\x00\x00\x01\x01\x00\x05\x18\xd8N"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


class _BlobStorage:
    """Fake Storage whose blobs live in a dict.

    ``open_blob(key)`` raises ``KeyError`` when key is absent.
    ``exists(prefix)`` returns True if any key starts with prefix.
    """

    def __init__(self, blobs: dict[str, bytes] | None = None) -> None:
        self._blobs: dict[str, bytes] = blobs or {}

    def upload_dir(self, prefix: str, local_dir: Any) -> None:  # noqa: ANN401
        pass

    def download_dir(self, prefix: str, dest: Any) -> None:  # noqa: ANN401
        pass

    def open_blob(self, key: str) -> bytes:
        if key not in self._blobs:
            raise KeyError(key)
        return self._blobs[key]

    def exists(self, prefix: str) -> bool:
        return any(k.startswith(prefix) for k in self._blobs)


def _make_client(storage: Any, db: Db | None = None) -> TestClient:
    """*db* defaults to an empty InMemoryDb — a run with no matching SimRecord
    404s on the ownership check (issue #44) regardless of what's in Storage."""
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db, get_storage

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_db] = lambda: db if db is not None else InMemoryDb()
    return TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# GET /api/results/{run_id} — serves result.json via storage.open_blob
# ---------------------------------------------------------------------------


class TestResultsViaStorage:
    def test_returns_200_when_blob_exists(self):
        """REQ-02.4: result.json fetched from Storage; 200 with job-status shape."""
        run_id = "20260605T120000Z-aabbccdd"
        payload = {
            "run_id": run_id,
            "scalars": {"apogee_m": 3200.0},
            "plot_urls": [],
            "warnings": [],
        }
        blobs = {f"results/{run_id}/result.json": json.dumps(payload).encode()}
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client(_BlobStorage(blobs), db=db)

        resp = client.get(f"/api/results/{run_id}", headers=_auth())

        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["run_id"] == run_id
        assert data["status"] == "done"
        assert data["result"] == {
            "run_id": run_id,
            "scalars": {"apogee_m": 3200.0},
            "plot_urls": [],
            "warnings": [],
        }

    def test_open_blob_called_with_correct_key(self):
        """Storage.open_blob must be called with 'results/{run_id}/result.json'."""
        run_id = "20260605T120000Z-opentest"
        payload = {"run_id": run_id, "scalars": {}, "plot_urls": [], "warnings": []}
        storage = MagicMock(spec=LocalFsStorage)
        storage.open_blob.return_value = json.dumps(payload).encode()

        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client(storage, db=db)
        resp = client.get(f"/api/results/{run_id}", headers=_auth())

        assert resp.status_code == 200
        storage.open_blob.assert_called_once_with(f"results/{run_id}/result.json")

    def test_open_blob_key_derives_from_org_scoped_prefix(self):
        """Issue #45: the key is read from the record's result_prefix, not
        reconstructed — so an org-scoped SimRecord resolves through its own
        orgs/{org_id}/... prefix, coexisting with the flat legacy layout
        (test_open_blob_called_with_correct_key, above) with no migration."""
        run_id = "20260605T120000Z-orgscoped"
        payload = {"run_id": run_id, "scalars": {}, "plot_urls": [], "warnings": []}
        storage = MagicMock(spec=LocalFsStorage)
        storage.open_blob.return_value = json.dumps(payload).encode()

        org_scoped_prefix = f"orgs/{_ORG}/results/{run_id}/"
        db = InMemoryDb()
        db.save_simulation(
            SimRecord(
                simulation_id=run_id,
                rocket_id="r-any",
                scenario={},
                created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
                created_by="test",
                org_id=_ORG,
                status="done",
                result_prefix=org_scoped_prefix,
            ),
            org_id=_ORG,
        )
        client = _make_client(storage, db=db)
        resp = client.get(f"/api/results/{run_id}", headers=_auth())

        assert resp.status_code == 200
        storage.open_blob.assert_called_once_with(f"{org_scoped_prefix}result.json")

    def test_returns_404_when_blob_absent(self):
        """REQ-02.4: owned run, but missing result.json → 404."""
        run_id = "20260605T120000Z-missing1"
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client(_BlobStorage(), db=db)  # empty storage

        resp = client.get(f"/api/results/{run_id}", headers=_auth())

        assert resp.status_code == 404

    def test_returns_404_for_another_orgs_run(self):
        """Issue #44: a run owned by another org must 404, not 200."""
        run_id = "20260605T120000Z-theirs001"
        payload = {"run_id": run_id, "scalars": {}, "plot_urls": [], "warnings": []}
        blobs = {f"results/{run_id}/result.json": json.dumps(payload).encode()}
        db = InMemoryDb()
        db.save_simulation(_sim(run_id, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        client = _make_client(_BlobStorage(blobs), db=db)

        resp = client.get(f"/api/results/{run_id}", headers=_auth())

        assert resp.status_code == 404

    def test_returns_401_without_auth(self):
        client = _make_client(_BlobStorage())
        resp = client.get("/api/results/some-run-id")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/results/{run_id}/series — serves series.json via storage.open_blob
# ---------------------------------------------------------------------------


class TestSeriesViaStorage:
    def test_returns_200_when_series_blob_exists(self):
        """REQ-02.6: series.json fetched from Storage; 200 with series payload."""
        run_id = "20260605T120000Z-series01"
        series_payload = {
            "t": [0.0, 1.0],
            "altitude": [0.0, 30.0],
            "speed": [25.0, 25.0],
            "mach": [0.0, 0.05],
            "acceleration": [9.81, 9.81],
            "path3d": [[0.0, 0.0, 0.0], [1.5, 2.0, 30.0]],
        }
        blobs = {f"results/{run_id}/series.json": json.dumps(series_payload).encode()}
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client(_BlobStorage(blobs), db=db)

        resp = client.get(f"/api/results/{run_id}/series", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        assert data["t"] == [0.0, 1.0]
        assert data["altitude"] == [0.0, 30.0]
        assert data["speed"] == [25.0, 25.0]
        assert data["mach"] == [0.0, 0.05]
        assert data["acceleration"] == [9.81, 9.81]
        assert data["path3d"][1] == [1.5, 2.0, 30.0]

    def test_returns_404_when_series_blob_absent(self):
        """REQ-02.6: owned run, but missing series.json → 404."""
        run_id = "20260605T120000Z-noseries"
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client(_BlobStorage(), db=db)

        resp = client.get(f"/api/results/{run_id}/series", headers=_auth())

        assert resp.status_code == 404

    def test_returns_404_for_another_orgs_series(self):
        """Issue #44: series owned by another org must 404, not 200."""
        run_id = "20260605T120000Z-theirseries"
        blobs = {f"results/{run_id}/series.json": json.dumps({"t": [0.0]}).encode()}
        db = InMemoryDb()
        db.save_simulation(_sim(run_id, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        client = _make_client(_BlobStorage(blobs), db=db)

        resp = client.get(f"/api/results/{run_id}/series", headers=_auth())

        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# GET /api/results/{run_id}/plots/{name}.png — serves PNG via storage.open_blob
# ---------------------------------------------------------------------------


class TestPlotsViaStorage:
    def test_serves_png_from_storage(self):
        """REQ-02.5: plot PNG fetched from Storage; 200 with image/png content-type."""
        run_id = "20260605T120000Z-plottest"
        plot_name = "trajectory_3d"
        blobs = {f"results/{run_id}/{plot_name}.png": _TINY_PNG}
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client(_BlobStorage(blobs), db=db)

        resp = client.get(f"/api/results/{run_id}/plots/{plot_name}.png", headers=_auth())

        assert resp.status_code == 200
        assert "image" in resp.headers.get("content-type", "")
        assert resp.content == _TINY_PNG

    def test_open_blob_called_with_correct_key_for_plot(self):
        """Storage.open_blob must be called with 'results/{run_id}/{name}.png'."""
        run_id = "20260605T120000Z-plotkey"
        plot_name = "energy_data"
        storage = MagicMock(spec=LocalFsStorage)
        storage.open_blob.return_value = _TINY_PNG

        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client(storage, db=db)
        resp = client.get(f"/api/results/{run_id}/plots/{plot_name}.png", headers=_auth())

        assert resp.status_code == 200
        storage.open_blob.assert_called_once_with(f"results/{run_id}/{plot_name}.png")

    def test_returns_404_when_plot_blob_absent(self):
        """REQ-02.5: owned run, but missing PNG → 404."""
        run_id = "20260605T120000Z-nopng123"
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        client = _make_client(_BlobStorage(), db=db)

        resp = client.get(f"/api/results/{run_id}/plots/nonexistent.png", headers=_auth())

        assert resp.status_code == 404

    def test_returns_404_for_another_orgs_plot(self):
        """Issue #44: PNGs get the same ownership check as the JSON endpoints."""
        run_id = "20260605T120000Z-theirspng"
        plot_name = "trajectory_3d"
        blobs = {f"results/{run_id}/{plot_name}.png": _TINY_PNG}
        db = InMemoryDb()
        db.save_simulation(_sim(run_id, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        client = _make_client(_BlobStorage(blobs), db=db)

        resp = client.get(f"/api/results/{run_id}/plots/{plot_name}.png", headers=_auth())

        assert resp.status_code == 404

    def test_path_traversal_blocked(self):
        """Directory traversal in plot name must be sanitized."""
        run_id = "20260605T120000Z-traverse"
        db = InMemoryDb()
        db.save_simulation(_sim(run_id), org_id=_ORG)
        # Even if the blob existed, the key must not contain '..'
        blobs = {"results/../secret.png": _TINY_PNG}
        client = _make_client(_BlobStorage(blobs), db=db)

        resp = client.get(f"/api/results/{run_id}/plots/../secret.png", headers=_auth())

        # Either 404 or the name is sanitized — must NOT serve /secret.png content
        assert resp.status_code in (404, 422)
