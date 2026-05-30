"""Tests for GET /api/results/{run_id} and GET /api/results/{run_id}/plots/{name}.png.

TDD: written BEFORE routers/results.py is implemented (RED phase).
Tasks: 1.33.
Coverage: file serving, 404 for missing, forward-compat job-status shape.
"""

from __future__ import annotations

import base64
import json

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
# GET /api/results/{run_id}
# ---------------------------------------------------------------------------


class TestResultsEndpoint:
    def test_returns_result_json_if_exists(self, tmp_path):
        """result.json found → 200 with forward-compat shape {run_id, status, result}."""
        run_id = "20260529T000000Z-abc12345"
        run_dir = tmp_path / run_id
        run_dir.mkdir(parents=True)

        payload = {
            "run_id": run_id,
            "scalars": {"apogee_m": 1000.0},
            "plot_urls": [],
            "warnings": [],
        }
        (run_dir / "result.json").write_text(json.dumps(payload))

        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings(
            basic_user="test", basic_pass="test", results_dir=tmp_path
        )

        client = TestClient(app)
        resp = client.get(f"/api/results/{run_id}", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        # Forward-compat shape (RG-9.7, design §11)
        assert data["run_id"] == run_id
        assert data["status"] == "done"
        assert "result" in data

    def test_returns_404_if_run_missing(self, tmp_path):
        """Missing run_id → 404."""
        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings(
            basic_user="test", basic_pass="test", results_dir=tmp_path
        )

        client = TestClient(app)
        resp = client.get("/api/results/nonexistent-run-id", headers=_auth())
        assert resp.status_code == 404

    def test_returns_401_without_auth(self, tmp_path):
        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings(
            basic_user="test", basic_pass="test", results_dir=tmp_path
        )

        client = TestClient(app)
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
        """Existing PNG file is served with 200 and image/png content-type."""
        run_id = "20260529T000000Z-png12345"
        run_dir = tmp_path / run_id
        run_dir.mkdir(parents=True)
        (run_dir / "trajectory_3d.png").write_bytes(_TINY_PNG)

        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings(
            basic_user="test", basic_pass="test", results_dir=tmp_path
        )

        client = TestClient(app)
        resp = client.get(f"/api/results/{run_id}/plots/trajectory_3d.png", headers=_auth())

        assert resp.status_code == 200
        assert "image" in resp.headers.get("content-type", "")

    def test_returns_404_for_missing_plot(self, tmp_path):
        """Missing plot file → 404."""
        run_id = "20260529T000000Z-nopng123"
        run_dir = tmp_path / run_id
        run_dir.mkdir(parents=True)

        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings(
            basic_user="test", basic_pass="test", results_dir=tmp_path
        )

        client = TestClient(app)
        resp = client.get(f"/api/results/{run_id}/plots/nonexistent.png", headers=_auth())
        assert resp.status_code == 404

    def test_returns_404_for_missing_run(self, tmp_path):
        """Missing run_id → 404."""
        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings(
            basic_user="test", basic_pass="test", results_dir=tmp_path
        )

        client = TestClient(app)
        resp = client.get("/api/results/nonexistent-run/plots/traj.png", headers=_auth())
        assert resp.status_code == 404

    def test_returns_401_without_auth(self, tmp_path):
        from icaro_api.config import Settings, get_settings
        from icaro_api.main import create_app

        app = create_app()
        app.dependency_overrides[get_settings] = lambda: Settings(
            basic_user="test", basic_pass="test", results_dir=tmp_path
        )

        client = TestClient(app)
        resp = client.get("/api/results/some-run/plots/traj.png")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# GET /api/results/{run_id}/series  (issue #11 — interactive charts data)
# ---------------------------------------------------------------------------


def _app(tmp_path):
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(
        basic_user="test", basic_pass="test", results_dir=tmp_path
    )
    return app


class TestSeriesEndpoint:
    def test_returns_series_json_if_exists(self, tmp_path):
        """series.json found → 200 with the time-series payload."""
        run_id = "20260529T000000Z-series01"
        run_dir = tmp_path / run_id
        run_dir.mkdir(parents=True)
        payload = {
            "t": [0.0, 1.0, 2.0],
            "altitude": [0.0, 30.0, 60.0],
            "speed": [25.0, 25.0, 25.0],
            "mach": [0.0, 0.05, 0.1],
            "acceleration": [9.81, 9.81, 9.81],
            "path3d": [[0.0, 0.0, 0.0], [1.5, 2.0, 30.0], [3.0, 4.0, 60.0]],
        }
        (run_dir / "series.json").write_text(json.dumps(payload))

        client = TestClient(_app(tmp_path))
        resp = client.get(f"/api/results/{run_id}/series", headers=_auth())

        assert resp.status_code == 200
        data = resp.json()
        assert data["t"] == [0.0, 1.0, 2.0]
        assert data["path3d"][1] == [1.5, 2.0, 30.0]

    def test_returns_404_when_series_missing(self, tmp_path):
        """Run exists but has no series.json (e.g. an old run) → 404 so the
        client falls back to the PNG plots."""
        run_id = "20260529T000000Z-noseries"
        (tmp_path / run_id).mkdir(parents=True)

        client = TestClient(_app(tmp_path))
        resp = client.get(f"/api/results/{run_id}/series", headers=_auth())
        assert resp.status_code == 404

    def test_returns_404_when_run_missing(self, tmp_path):
        client = TestClient(_app(tmp_path))
        resp = client.get("/api/results/does-not-exist/series", headers=_auth())
        assert resp.status_code == 404

    def test_returns_401_without_auth(self, tmp_path):
        client = TestClient(_app(tmp_path))
        resp = client.get("/api/results/some-run/series")
        assert resp.status_code == 401
