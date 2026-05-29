"""Tests for routers/ui.py — server-rendered Jinja2 wizard.

TDD: written BEFORE ui.py is implemented (RED phase).
Tasks: 1.35–1.41.

Coverage:
  - GET /       (step1_rocket.html) → 200 + upload zone DOM hook
  - GET /step2  (step2_basics.html) → 200 + map container id + datetime input
  - GET /step3  (step3_advanced.html) → 200 + <details> present and NOT open
  - GET /results/{run_id} → renders scalars with plain labels (not raw keys)
  - Auth on UI routes: no creds → 401

All tests are pure unit tests (no network, no JVM, no real run dirs).
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_ui_client(tmp_path: Path) -> TestClient:
    """Build a TestClient for the full create_app() with auth + results_dir overridden."""
    from icaro_api.main import create_app
    from icaro_api.config import Settings, get_settings

    app = create_app()

    def override_settings():
        return Settings(
            basic_user="test",
            basic_pass="test",
            results_dir=tmp_path,
        )

    app.dependency_overrides[get_settings] = override_settings
    return TestClient(app, raise_server_exceptions=True)


def _auth_header() -> dict[str, str]:
    token = base64.b64encode(b"test:test").decode()
    return {"Authorization": f"Basic {token}"}


def _make_fake_run(tmp_path: Path, run_id: str) -> None:
    """Write a minimal result.json so GET /results/{run_id} can render."""
    run_dir = tmp_path / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    result = {
        "run_id": run_id,
        "scalars": {
            "apogee_m": 1234.5,
            "max_velocity_ms": 250.0,
            "flight_time_s": 45.2,
        },
        "plot_urls": [f"/api/results/{run_id}/plots/trajectory_3d.png"],
        "warnings": [],
    }
    (run_dir / "result.json").write_text(json.dumps(result))


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def client(tmp_path):
    return _make_ui_client(tmp_path)


@pytest.fixture
def auth():
    return _auth_header()


# ---------------------------------------------------------------------------
# GET / — Step 1: Rocket upload
# ---------------------------------------------------------------------------


class TestStep1Route:
    def test_get_root_returns_200(self, client, auth):
        resp = client.get("/", headers=auth)
        assert resp.status_code == 200

    def test_get_root_contains_upload_zone(self, client, auth):
        """Upload drop zone must be present (AC-RG-4.1 — upload state machine)."""
        resp = client.get("/", headers=auth)
        body = resp.text
        # The upload zone has id="upload-zone" per wizard.js wiring
        assert "upload-zone" in body

    def test_get_root_contains_ork_file_input(self, client, auth):
        """File input accepting .ork must be present."""
        resp = client.get("/", headers=auth)
        body = resp.text
        assert ".ork" in body or 'accept=".ork"' in body or "ork" in body.lower()

    def test_get_root_no_auth_returns_401(self, client):
        """UI routes must require auth (RG-8.1)."""
        resp = client.get("/")
        assert resp.status_code == 401

    def test_get_root_contains_loading_indicator(self, client, auth):
        """Loading indicator must be in HTML (visible within 200ms — AC-RG-4.1)."""
        resp = client.get("/", headers=auth)
        body = resp.text
        # loading state element
        assert "loading" in body.lower() or "upload-loading" in body


# ---------------------------------------------------------------------------
# GET /step2 — Step 2: Basics (map + date/time)
# ---------------------------------------------------------------------------


class TestStep2Route:
    def test_get_step2_returns_200(self, client, auth):
        resp = client.get("/step2", headers=auth)
        assert resp.status_code == 200

    def test_get_step2_contains_map_container(self, client, auth):
        """Leaflet map container must be present (RG-3.2)."""
        resp = client.get("/step2", headers=auth)
        body = resp.text
        # Leaflet attaches to an element with id="map"
        assert 'id="map"' in body

    def test_get_step2_contains_datetime_input(self, client, auth):
        """Calendar date-time picker must be present (RG-3.3)."""
        resp = client.get("/step2", headers=auth)
        body = resp.text
        assert 'type="datetime-local"' in body

    def test_get_step2_contains_lat_lon_inputs(self, client, auth):
        """Manual lat/lon inputs must be present (AC-RG-3.11)."""
        resp = client.get("/step2", headers=auth)
        body = resp.text
        assert "latitude" in body.lower() or "lat" in body
        assert "longitude" in body.lower() or "lon" in body

    def test_get_step2_no_auth_returns_401(self, client):
        resp = client.get("/step2")
        assert resp.status_code == 401

    def test_get_step2_contains_leaflet_js(self, client, auth):
        """Leaflet must be loaded via CDN."""
        resp = client.get("/step2", headers=auth)
        body = resp.text
        assert "leaflet" in body.lower()

    def test_get_step2_contains_atmosphere_badge_hook(self, client, auth):
        """Atmosphere badge element must be present for JS to update (RG-3.3)."""
        resp = client.get("/step2", headers=auth)
        body = resp.text
        assert "atmosphere" in body.lower() or "atm-badge" in body


# ---------------------------------------------------------------------------
# GET /step3 — Step 3: Advanced (collapsed by default)
# ---------------------------------------------------------------------------


class TestStep3Route:
    def test_get_step3_returns_200(self, client, auth):
        resp = client.get("/step3", headers=auth)
        assert resp.status_code == 200

    def test_get_step3_contains_details_element(self, client, auth):
        """<details> disclosure must be present (AC-RG-3.6)."""
        resp = client.get("/step3", headers=auth)
        body = resp.text
        assert "<details" in body

    def test_get_step3_details_not_open_by_default(self, client, auth):
        """<details open> must NOT appear — collapsed is the default (AC-RG-3.6)."""
        resp = client.get("/step3", headers=auth)
        body = resp.text
        # details open or details  open would mean it's expanded
        assert "<details open" not in body and "<details  open" not in body

    def test_get_step3_no_auth_returns_401(self, client):
        resp = client.get("/step3")
        assert resp.status_code == 401

    def test_get_step3_contains_uncertainty_section(self, client, auth):
        """Uncertainty preset radio group must be present (RG-3.4)."""
        resp = client.get("/step3", headers=auth)
        body = resp.text
        assert "Typical" in body
        assert "Conservative" in body
        assert "Precise" in body

    def test_get_step3_typical_preset_checked_by_default(self, client, auth):
        """Typical preset must be the default selection (AC-RG-3.7)."""
        resp = client.get("/step3", headers=auth)
        body = resp.text
        # Typical radio input must have 'checked' attribute
        assert "Typical" in body
        # The checked attribute must be near "Typical"
        typical_idx = body.find("Typical")
        surrounding = body[max(0, typical_idx - 200) : typical_idx + 200]
        assert "checked" in surrounding


# ---------------------------------------------------------------------------
# GET /results/{run_id} — Results page
# ---------------------------------------------------------------------------


class TestResultsRoute:
    def test_get_results_returns_200(self, client, auth, tmp_path):
        run_id = "test-run-001"
        _make_fake_run(tmp_path, run_id)
        resp = client.get(f"/results/{run_id}", headers=auth)
        assert resp.status_code == 200

    def test_get_results_shows_plain_label_not_raw_key(self, client, auth, tmp_path):
        """AC-RG-6.1: 'apogee_m' must NOT appear; plain label must appear."""
        run_id = "test-run-002"
        _make_fake_run(tmp_path, run_id)
        resp = client.get(f"/results/{run_id}", headers=auth)
        body = resp.text
        assert "apogee_m" not in body
        # Plain label from _SCALAR_LABEL_MAP: "Highest point (apogee)"
        assert "apogee" in body.lower() or "highest point" in body.lower()

    def test_get_results_shows_scalar_value(self, client, auth, tmp_path):
        """Scalar value must appear in the rendered page."""
        run_id = "test-run-003"
        _make_fake_run(tmp_path, run_id)
        resp = client.get(f"/results/{run_id}", headers=auth)
        body = resp.text
        assert "1234" in body  # apogee_m = 1234.5

    def test_get_results_shows_plot_img(self, client, auth, tmp_path):
        """Plot <img> tags must be rendered (RG-6.2)."""
        run_id = "test-run-004"
        _make_fake_run(tmp_path, run_id)
        resp = client.get(f"/results/{run_id}", headers=auth)
        body = resp.text
        assert "<img" in body
        assert "trajectory_3d" in body

    def test_get_results_no_auth_returns_401(self, client):
        resp = client.get("/results/some-run-id")
        assert resp.status_code == 401

    def test_get_results_missing_run_returns_404(self, client, auth):
        """Non-existent run_id → 404."""
        resp = client.get("/results/nonexistent-run-xyz", headers=auth)
        assert resp.status_code == 404

    def test_get_results_raw_key_absent_for_all_scalars(self, client, auth, tmp_path):
        """No raw scalar key from _SCALAR_ATTR_MAP should appear verbatim (AC-RG-6.1)."""
        run_id = "test-run-005"
        _make_fake_run(tmp_path, run_id)
        resp = client.get(f"/results/{run_id}", headers=auth)
        body = resp.text
        # Test the keys that appear in the fake result
        for raw_key in ("apogee_m", "max_velocity_ms", "flight_time_s"):
            assert raw_key not in body, f"Raw key '{raw_key}' must not appear in results HTML"

    def test_get_results_warnings_banner_when_warnings_present(self, client, auth, tmp_path):
        """AC-RG-6.2: warnings banner must appear when warnings non-empty."""
        run_id = "test-run-006"
        run_dir = tmp_path / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        result = {
            "run_id": run_id,
            "scalars": {"apogee_m": 500.0},
            "plot_urls": [],
            "warnings": ["Standard atmosphere used because date was out of GFS window."],
        }
        (run_dir / "result.json").write_text(json.dumps(result))
        resp = client.get(f"/results/{run_id}", headers=auth)
        body = resp.text
        assert "Standard atmosphere" in body or "standard atmosphere" in body.lower()

    def test_get_results_no_warnings_banner_when_empty(self, client, auth, tmp_path):
        """No warning banner when warnings list is empty."""
        run_id = "test-run-007"
        _make_fake_run(tmp_path, run_id)
        resp = client.get(f"/results/{run_id}", headers=auth)
        body = resp.text
        # The warning section should not appear at all when warnings is empty.
        # We check that there is no "warning" class visible content related to GFS
        # (the specific warning text used in the other test should not be present).
        assert "Standard atmosphere used" not in body


# ---------------------------------------------------------------------------
# POST /step2 — Step 2 form submission (validate + advance)
# ---------------------------------------------------------------------------


class TestStep2Post:
    def test_post_step2_bad_longitude_rerenders_with_inline_error(
        self, client, auth
    ):
        """AC-RG-3.9: out-of-range longitude → re-render Step 2 with inline error,
        no traceback, and DOES NOT advance to Step 3."""
        resp = client.post(
            "/step2",
            headers=auth,
            data={
                "export_id": "exp-1",
                "latitude": "39.5",
                "longitude": "999",  # out of range → domain validator rejects
                "elevation": "",
                "launch_datetime": "2026-06-10T10:00",
                "atmosphere_model": "standard_atmosphere",
            },
        )
        assert resp.status_code == 200
        body = resp.text
        # Stayed on Step 2 (map container is the Step-2 marker), not Step 3.
        assert 'id="map"' in body
        # Plain-language longitude error surfaced (humanized, not a pydantic dump).
        assert "Longitude must be between" in body
        # RG-9.4 — never a raw traceback.
        assert "Traceback" not in body

    def test_post_step2_valid_advances_to_step3(self, client, auth):
        """Valid site → render Step 3 (advanced options)."""
        resp = client.post(
            "/step2",
            headers=auth,
            data={
                "export_id": "exp-1",
                "latitude": "39.5",
                "longitude": "-0.4",
                "elevation": "",
                "launch_datetime": "2026-06-10T10:00",
                "atmosphere_model": "standard_atmosphere",
            },
        )
        assert resp.status_code == 200
        body = resp.text
        # Step 3 markers: the advanced <details> + the uncertainty presets.
        assert "<details" in body
        assert "Typical" in body

    def test_post_step2_forecast_with_date_advances(self, client, auth):
        """Regression: forecast model + a picked date → date block derived →
        validation passes → advance to Step 3 (the Alicante smoke case)."""
        resp = client.post(
            "/step2",
            headers=auth,
            data={
                "export_id": "exp-1",
                "latitude": "38.343637",
                "longitude": "-0.488171",
                "elevation": "26",
                "launch_datetime": "2026-06-01T09:54",
                "atmosphere_model": "forecast",  # set by the atmosphere-suggest JS
            },
        )
        assert resp.status_code == 200
        body = resp.text
        # Advanced to Step 3 — no "requires a 'date' block" error.
        assert "<details" in body
        assert "requires a 'date' block" not in body

    def test_post_step2_forecast_without_date_errors(self, client, auth):
        """forecast with NO date → inline error asking for the date, stays on Step 2."""
        resp = client.post(
            "/step2",
            headers=auth,
            data={
                "export_id": "exp-1",
                "latitude": "38.343637",
                "longitude": "-0.488171",
                "elevation": "26",
                "launch_datetime": "",
                "atmosphere_model": "forecast",
            },
        )
        assert resp.status_code == 200
        body = resp.text
        assert 'id="map"' in body  # stayed on Step 2
        assert "date" in body.lower()

    def test_post_step2_validation_fails_closed(self, client, auth, monkeypatch):
        """If the validation call raises unexpectedly, the form is treated as
        INVALID (fail closed) — it must NOT silently advance to Step 3."""
        import icaro_api.routers.ui as ui

        def _boom(_body):
            raise RuntimeError("validation backend exploded")

        monkeypatch.setattr(ui, "_api_validate", _boom)

        resp = client.post(
            "/step2",
            headers=auth,
            data={
                "export_id": "exp-1",
                "latitude": "39.5",
                "longitude": "-0.4",
                "elevation": "",
                "launch_datetime": "2026-06-10T10:00",
                "atmosphere_model": "standard_atmosphere",
            },
        )
        assert resp.status_code == 200
        body = resp.text
        # Stayed on Step 2 with a generic, non-empty error — NOT advanced.
        assert 'id="map"' in body
        assert "Could not validate" in body
        assert "Traceback" not in body


# ---------------------------------------------------------------------------
# POST /step3 — Step 3 form submission (validate + simulate + results)
# ---------------------------------------------------------------------------


class TestStep3Post:
    def _valid_step3_data(self) -> dict[str, str]:
        return {
            "export_id": "exp-1",
            "latitude": "39.5",
            "longitude": "-0.4",
            "elevation": "12",
            "launch_datetime": "2026-06-10T10:00",
            "atmosphere_model": "standard_atmosphere",
            "atmosphere_override": "",
            "uncertainty_preset": "Typical",
        }

    def test_post_step3_happy_path_renders_results(self, client, auth, monkeypatch):
        """Valid scenario + successful simulate → results page with plain labels."""
        import icaro_api.routers.ui as ui

        # Isolate from the scenario model: validation passes.
        monkeypatch.setattr(ui, "_api_validate", lambda _body: {})
        # Stub the simulate route function with a fake result.
        fake_result = {
            "run_id": "20260610T100000Z-deadbeef",
            "scalars": {"apogee_m": 1850.0, "max_velocity_ms": 300.0},
            "plot_urls": ["/api/results/20260610T100000Z-deadbeef/plots/trajectory_3d.png"],
            "warnings": [],
        }
        monkeypatch.setattr(ui, "_api_simulate", lambda req, settings: fake_result)

        resp = client.post("/step3", headers=auth, data=self._valid_step3_data())
        assert resp.status_code == 200
        body = resp.text
        # Results page: plain label, scalar value, plot img — and NO raw key.
        assert "apogee_m" not in body
        assert "1850" in body
        assert "<img" in body

    def test_post_step3_simulate_unavailable_shows_friendly_error(
        self, client, auth, monkeypatch
    ):
        """Simulate raising 503 → re-render Step 3 with the friendly hint, no traceback."""
        import icaro_api.routers.ui as ui
        from fastapi import HTTPException

        monkeypatch.setattr(ui, "_api_validate", lambda _body: {})

        def _raise_503(req, settings):
            raise HTTPException(
                status_code=503,
                detail={"error": "convert_unavailable", "hint": "Install Java 21 on the server."},
            )

        monkeypatch.setattr(ui, "_api_simulate", _raise_503)

        resp = client.post("/step3", headers=auth, data=self._valid_step3_data())
        assert resp.status_code == 200
        body = resp.text
        assert "Simulation service unavailable" in body
        assert "Install Java 21" in body
        assert "Traceback" not in body
