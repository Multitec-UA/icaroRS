"""Tests for GET /api/history — T-22, T-23.

TDD: T-22 (RED) written first; T-23 (GREEN) wires history.py.
Req: REQ-05.1 (reverse-chronological list)
     REQ-05.2 (fields: simulation_id, rocket_id, name, created_at, status, scalars.apogee)
     REQ-05.3 (limit param, default 20, max 100)
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import pytest
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import InMemoryDb, RocketRecord, SimRecord

_TEST_SESSION_COOKIE = "test-session-token"


def _fake_verify_identity(cookie: str) -> dict:
    if cookie != _TEST_SESSION_COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": "test-org"}


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_TEST_SESSION_COOKIE}"}


def _make_client(db: Any) -> TestClient:
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db

    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings()
    app.dependency_overrides[get_identity_verifier] = lambda: _fake_verify_identity
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, raise_server_exceptions=True)


def _rocket(rocket_id: str, name: str) -> RocketRecord:
    return RocketRecord(
        rocket_id=rocket_id,
        name=name,
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        created_by="test",
        export_prefix=f"exports/{rocket_id}/",
    )


def _sim(
    sim_id: str,
    rocket_id: str,
    created_at: datetime,
    status: str = "done",
    apogee: float = 3000.0,
) -> SimRecord:
    return SimRecord(
        simulation_id=sim_id,
        rocket_id=rocket_id,
        scenario={},
        created_at=created_at,
        created_by="test",
        status=status,
        scalars={"apogee_m": apogee},
        warnings=[],
        result_prefix=f"results/{sim_id}/",
    )


_T1 = datetime(2026, 1, 10, tzinfo=timezone.utc)
_T2 = datetime(2026, 2, 10, tzinfo=timezone.utc)
_T3 = datetime(2026, 3, 10, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# GET /api/history
# ---------------------------------------------------------------------------


class TestHistoryList:
    def test_returns_200(self):
        """GET /api/history returns 200 OK."""
        db = InMemoryDb()
        client = _make_client(db)
        resp = client.get("/api/history", headers=_auth())
        assert resp.status_code == 200

    def test_returns_reverse_chronological_order(self):
        """REQ-05.1: list must be newest-first."""
        db = InMemoryDb()
        rocket_id = "r-chrono"
        db.save_rocket(_rocket(rocket_id, "Chrono"))
        db.save_simulation(_sim("s1", rocket_id, _T1))
        db.save_simulation(_sim("s2", rocket_id, _T2))
        db.save_simulation(_sim("s3", rocket_id, _T3))
        client = _make_client(db)

        resp = client.get("/api/history", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        ids = [item["simulation_id"] for item in items]
        assert ids == ["s3", "s2", "s1"], (
            f"Expected reverse-chrono [s3, s2, s1], got {ids}"
        )

    def test_items_have_required_fields(self):
        """REQ-05.2: each item must have simulation_id, rocket_id, name,
        created_at, status, and scalars.apogee."""
        db = InMemoryDb()
        rocket_id = "r-fields"
        db.save_rocket(_rocket(rocket_id, "FieldsRocket"))
        db.save_simulation(_sim("s-fields", rocket_id, _T1, apogee=3200.0))
        client = _make_client(db)

        resp = client.get("/api/history", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        item = items[0]

        for field in ("simulation_id", "rocket_id", "name", "created_at", "status", "scalars"):
            assert field in item, f"Missing field {field!r}: {list(item.keys())}"

        # apogee must be accessible within scalars
        scalars = item["scalars"]
        apogee_val = scalars.get("apogee") or scalars.get("apogee_m")
        assert apogee_val is not None, (
            f"scalars must contain apogee (REQ-05.2): {scalars}"
        )
        assert apogee_val == 3200.0

    def test_name_is_denormalized_from_rocket(self):
        """REQ-05.2: 'name' must be the rocket name (not empty)."""
        db = InMemoryDb()
        rocket_id = "r-denom"
        db.save_rocket(_rocket(rocket_id, "MyFancyRocket"))
        db.save_simulation(_sim("s-denom", rocket_id, _T1))
        client = _make_client(db)

        resp = client.get("/api/history", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert items[0]["name"] == "MyFancyRocket", (
            f"Expected denormalized name 'MyFancyRocket', got {items[0]['name']!r}"
        )

    def test_default_limit_is_20(self):
        """REQ-05.3: default limit must be 20."""
        db = InMemoryDb()
        rocket_id = "r-lim"
        db.save_rocket(_rocket(rocket_id, "LimRocket"))
        for i in range(25):
            dt = datetime(2026, 1, i + 1, tzinfo=timezone.utc)
            db.save_simulation(_sim(f"s-lim-{i}", rocket_id, dt))
        client = _make_client(db)

        resp = client.get("/api/history", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 20, f"Default limit must be 20; got {len(items)}"

    def test_limit_param_is_respected(self):
        """REQ-05.3: ?limit=5 must return at most 5 items."""
        db = InMemoryDb()
        rocket_id = "r-lim5"
        db.save_rocket(_rocket(rocket_id, "Lim5Rocket"))
        for i in range(10):
            dt = datetime(2026, 1, i + 1, tzinfo=timezone.utc)
            db.save_simulation(_sim(f"s-l5-{i}", rocket_id, dt))
        client = _make_client(db)

        resp = client.get("/api/history?limit=5", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 5

    def test_returns_empty_list_when_no_simulations(self):
        """Empty db → empty list, not 404."""
        db = InMemoryDb()
        client = _make_client(db)
        resp = client.get("/api/history", headers=_auth())
        assert resp.status_code == 200
        assert resp.json() == []

    def test_returns_401_without_auth(self):
        db = InMemoryDb()
        client = _make_client(db)
        resp = client.get("/api/history")
        assert resp.status_code == 401

    def test_error_status_items_are_included(self):
        """Simulations with status='error' must appear in history."""
        db = InMemoryDb()
        rocket_id = "r-err"
        db.save_rocket(_rocket(rocket_id, "ErrorRocket"))
        db.save_simulation(_sim("s-err", rocket_id, _T1, status="error"))
        client = _make_client(db)

        resp = client.get("/api/history", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        assert items[0]["status"] == "error"

    def test_cursor_before_param(self):
        """REQ-05.3: ?before= cursor returns only older simulations."""
        db = InMemoryDb()
        rocket_id = "r-cursor"
        db.save_rocket(_rocket(rocket_id, "CursorRocket"))
        db.save_simulation(_sim("s-old", rocket_id, _T1))
        db.save_simulation(_sim("s-mid", rocket_id, _T2))
        db.save_simulation(_sim("s-new", rocket_id, _T3))
        client = _make_client(db)

        qs = urlencode({"before": _T3.isoformat()})
        resp = client.get(f"/api/history?{qs}", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        ids = [item["simulation_id"] for item in items]
        assert "s-new" not in ids, (
            f"'before' cursor failed: s-new (T3) should be excluded; got {ids}"
        )


# ---------------------------------------------------------------------------
# BUG 1 — scenario field missing from GET /api/history (RED before fix)
# Closes verify S-01: no end-to-end replay test existed.
# ---------------------------------------------------------------------------


class TestHistoryScenarioField:
    """Assert GET /api/history items include the scenario field (BUG 1)."""

    def test_history_item_includes_scenario_key(self):
        """Each history item MUST carry the scenario dict as stored in SimRecord.

        Before the fix: 'scenario' key is absent → item.scenario is undefined →
        HistoryList.handleReRun calls simulate(rocket_id, undefined) → 422.
        """
        db = InMemoryDb()
        rocket_id = "r-scenario"
        db.save_rocket(_rocket(rocket_id, "ScenarioRocket"))

        scenario_payload = {
            "site": {"latitude": 1.0, "longitude": 2.0, "elevation": 100.0},
            "datetime": "2026-06-01T12:00:00Z",
        }
        sim = SimRecord(
            simulation_id="s-scenario",
            rocket_id=rocket_id,
            scenario=scenario_payload,
            created_at=_T1,
            created_by="test",
            status="done",
            scalars={"apogee_m": 1000.0},
        )
        db.save_simulation(sim)
        client = _make_client(db)

        resp = client.get("/api/history", headers=_auth())

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        item = items[0]
        assert "scenario" in item, (
            f"'scenario' key missing from history item — BUG 1: {list(item.keys())}"
        )
        assert item["scenario"] == scenario_payload, (
            f"scenario round-trip failed: {item['scenario']!r} != {scenario_payload!r}"
        )

    def test_history_scenario_enables_replay_without_422(self):
        """End-to-end replay test (closes S-01 gap).

        Verifies that the scenario returned by GET /api/history validates against
        the same Pydantic model POST /api/simulate uses — so re-submitting it
        does NOT produce a 422 Unprocessable Content.

        Strategy: we do NOT run a real RocketPy sim; we only validate that
        SimulateRequest(export_id=..., scenario=returned_scenario) passes Pydantic
        validation without errors.  This is exactly what caused the regression:
        undefined scenario → Pydantic rejects the body → 422.
        """
        from icaro_api.routers.simulate import SimulateRequest

        db = InMemoryDb()
        rocket_id = "r-replay"
        db.save_rocket(_rocket(rocket_id, "ReplayRocket"))

        # Minimal valid scenario that icaro.scenario.Scenario accepts.
        scenario_payload: dict = {
            "site": {"latitude": 48.8, "longitude": 2.3, "elevation": 35.0},
            "datetime": "2026-07-04T14:00:00Z",
        }
        db.save_simulation(
            SimRecord(
                simulation_id="s-replay",
                rocket_id=rocket_id,
                scenario=scenario_payload,
                created_at=_T1,
                created_by="test",
                status="done",
                scalars={"apogee_m": 2500.0},
            )
        )
        client = _make_client(db)

        # Step 1: fetch history and extract scenario
        resp = client.get("/api/history", headers=_auth())
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 1
        returned_scenario = items[0].get("scenario")
        assert returned_scenario is not None, (
            "scenario missing from GET /api/history — BUG 1 not fixed"
        )

        # Step 2: assert the returned scenario validates — no 422
        # (SimulateRequest uses Pydantic; invalid body raises ValidationError)
        from pydantic import ValidationError

        try:
            SimulateRequest(export_id=rocket_id, scenario=returned_scenario)
        except ValidationError as exc:
            raise AssertionError(
                f"Returned scenario failed Pydantic validation → would cause 422 on replay: {exc}"
            ) from exc
