"""Tests for GET /api/scenario/template and POST /api/scenario/validate.

TDD: written BEFORE routers/scenario.py is implemented (RED phase).
Tasks: 1.19, 1.20.
Coverage: AC-RG-2.3, AC-RG-2.4, AC-RG-3.7, AC-RG-3.8, ADR-2.
"""

from __future__ import annotations

import base64
import pytest
from fastapi.testclient import TestClient


def _make_client() -> TestClient:
    """Build a TestClient for the full create_app() with auth overridden."""
    from icaro_api.main import create_app
    from icaro_api.config import Settings, get_settings

    app = create_app()

    def override_settings():
        return Settings(basic_user="test", basic_pass="test")

    app.dependency_overrides[get_settings] = override_settings
    return TestClient(app, raise_server_exceptions=True)


def _auth_header() -> dict:
    token = base64.b64encode(b"test:test").decode()
    return {"Authorization": f"Basic {token}"}


@pytest.fixture
def client():
    return _make_client()


@pytest.fixture
def auth():
    return _auth_header()


# ---------------------------------------------------------------------------
# GET /api/scenario/template
# ---------------------------------------------------------------------------


class TestScenarioTemplate:
    def test_returns_200(self, client, auth):
        resp = client.get("/api/scenario/template", headers=auth)
        assert resp.status_code == 200

    def test_uncertainty_is_non_null(self, client, auth):
        """AC-RG-2.3: returned dict has non-null uncertainty."""
        resp = client.get("/api/scenario/template", headers=auth)
        data = resp.json()
        assert data.get("uncertainty") is not None
        assert isinstance(data["uncertainty"], dict)
        assert len(data["uncertainty"]) > 0

    def test_atmosphere_model_is_non_null(self, client, auth):
        """AC-RG-2.3: non-null environment.atmosphere_model (or atmosphere.model)."""
        resp = client.get("/api/scenario/template", headers=auth)
        data = resp.json()
        # Template returns atmosphere.model inside the atmosphere block.
        atm = data.get("atmosphere") or {}
        assert atm.get("model") is not None

    def test_presets_block_present(self, client, auth):
        """Template includes an uncertainty_presets block with Typical/Conservative/Precise."""
        resp = client.get("/api/scenario/template", headers=auth)
        data = resp.json()
        presets = data.get("uncertainty_presets")
        assert presets is not None
        assert "Typical" in presets
        assert "Conservative" in presets
        assert "Precise" in presets

    def test_typical_preset_matches_default_uncertainty(self, client, auth):
        """AC-RG-3.7: Typical preset == DEFAULT_UNCERTAINTY (by value)."""
        from icaro.scenario import DEFAULT_UNCERTAINTY

        resp = client.get("/api/scenario/template", headers=auth)
        data = resp.json()
        presets = data["uncertainty_presets"]
        typical = presets["Typical"]

        # Convert DEFAULT_UNCERTAINTY to comparable dict form.
        expected = {k: v.model_dump() for k, v in DEFAULT_UNCERTAINTY.items()}
        assert typical == expected

    def test_returns_401_without_auth(self, client):
        resp = client.get("/api/scenario/template")
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# POST /api/scenario/validate
# ---------------------------------------------------------------------------

_VALID_SCENARIO = {
    "name": "test_scenario",
    "site": {"latitude": 48.8566, "longitude": 2.3522, "elevation": 35.0},
    "atmosphere": {"model": "standard_atmosphere"},
}

_BAD_LONGITUDE_SCENARIO = {
    "name": "bad_lon",
    "site": {"latitude": 48.8566, "longitude": 999.0},
    "atmosphere": {"model": "standard_atmosphere"},
}


class TestScenarioValidate:
    def test_valid_body_returns_200(self, client, auth):
        resp = client.post(
            "/api/scenario/validate", json=_VALID_SCENARIO, headers=auth
        )
        assert resp.status_code == 200

    def test_valid_body_returns_normalized_dict(self, client, auth):
        """POST valid scenario returns a normalized scenario dict."""
        resp = client.post(
            "/api/scenario/validate", json=_VALID_SCENARIO, headers=auth
        )
        data = resp.json()
        assert isinstance(data, dict)
        assert "site" in data
        assert data["site"]["latitude"] == pytest.approx(48.8566)
        assert data["site"]["longitude"] == pytest.approx(2.3522)

    def test_bad_longitude_returns_422(self, client, auth):
        """AC-RG-2.4: invalid field → 422."""
        resp = client.post(
            "/api/scenario/validate", json=_BAD_LONGITUDE_SCENARIO, headers=auth
        )
        assert resp.status_code == 422

    def test_bad_longitude_errors_contain_site_loc(self, client, auth):
        """AC-RG-2.4: errors[].loc references site.longitude path."""
        resp = client.post(
            "/api/scenario/validate", json=_BAD_LONGITUDE_SCENARIO, headers=auth
        )
        data = resp.json()
        errors = data.get("detail") or data.get("errors") or []
        # Accept either FastAPI's default detail structure or our custom one.
        locs = []
        for err in errors:
            loc = err.get("loc") or []
            locs.extend(loc)
        assert "longitude" in locs or "site" in locs

    def test_no_traceback_in_validation_error(self, client, auth):
        """AC-RG-3.9 / RG-9.4: no Python traceback in error body."""
        resp = client.post(
            "/api/scenario/validate", json=_BAD_LONGITUDE_SCENARIO, headers=auth
        )
        body = resp.text
        assert "Traceback" not in body
        assert "traceback" not in body

    def test_missing_site_returns_422(self, client, auth):
        """Missing required field site → 422."""
        resp = client.post(
            "/api/scenario/validate",
            json={"name": "no_site", "atmosphere": {"model": "standard_atmosphere"}},
            headers=auth,
        )
        assert resp.status_code == 422

    def test_returns_401_without_auth(self, client):
        resp = client.post("/api/scenario/validate", json=_VALID_SCENARIO)
        assert resp.status_code == 401


# ---------------------------------------------------------------------------
# Preset mapping (task 1.20)
# ---------------------------------------------------------------------------


class TestPresets:
    def test_typical_equals_default_uncertainty(self):
        """ADR-2 / AC-RG-3.7: PRESETS['Typical'] == DEFAULT_UNCERTAINTY."""
        from icaro.scenario import DEFAULT_UNCERTAINTY
        from icaro_api.routers.scenario import PRESETS

        expected = {k: v.model_dump() for k, v in DEFAULT_UNCERTAINTY.items()}
        assert PRESETS["Typical"] == expected

    def test_conservative_is_dict(self):
        from icaro_api.routers.scenario import PRESETS

        assert isinstance(PRESETS["Conservative"], dict)

    def test_precise_is_dict(self):
        from icaro_api.routers.scenario import PRESETS

        assert isinstance(PRESETS["Precise"], dict)

    def test_all_presets_produce_valid_scenario(self):
        """AC-RG-3.8: all three presets produce a valid Scenario when embedded."""
        from icaro.scenario import Scenario
        from icaro_api.routers.scenario import PRESETS

        base = {
            "site": {"latitude": 48.8566, "longitude": 2.3522},
            "atmosphere": {"model": "standard_atmosphere"},
        }
        for name, preset in PRESETS.items():
            scenario_dict = {**base, "uncertainty": preset}
            scenario = Scenario.model_validate(scenario_dict)
            assert scenario.uncertainty is not None, f"Preset {name} produced null uncertainty"

    def test_typical_and_precise_differ(self):
        from icaro_api.routers.scenario import PRESETS

        assert PRESETS["Typical"] != PRESETS["Precise"]

    def test_typical_and_conservative_differ(self):
        from icaro_api.routers.scenario import PRESETS

        assert PRESETS["Typical"] != PRESETS["Conservative"]
