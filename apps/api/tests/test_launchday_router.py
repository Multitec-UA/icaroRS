"""Tests for POST /api/launchday — rail recommendation sweep (S5, S7).

``recommend_rail`` is patched with a fake returning a real ``RailSweep`` built
from fake candidates, so no flight is simulated.
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from icaro.launchday import (
    LaunchCheck,
    LaunchLimits,
    RailCandidate,
    RailSweep,
    SkippedCandidate,
    WindUsed,
)
from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import ExportRecord, InMemoryDb
from icaro_api.services.storage import LocalFsStorage
from icaro_api.simulate_lock import _SIMULATE_LOCK

_COOKIE = "test-session-token"
_ORG = "test-org"
_OTHER_ORG = "other-org"


def _verify(cookie: str) -> dict:
    if cookie != _COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": _ORG}


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_COOKIE}"}


def _seed_export(db, export_id="exp-1", org_id=_ORG):
    db.save_export(
        ExportRecord(
            export_id=export_id,
            rocket_id="rk-1",
            name="TestRocket",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            created_by="test",
            org_id=org_id,
            export_prefix=f"exports/{export_id}/",
        ),
        org_id=org_id,
    )


def _candidate(inclination, heading, distance, checks_ok=True) -> RailCandidate:
    return RailCandidate(
        inclination=inclination,
        heading=heading,
        apogee_agl=480.0,
        landing_distance=distance,
        landing_bearing=90.0,
        out_of_rail_velocity=18.0,
        stability_margin_min=1.8,
        impact_velocity=5.5,
        checks_ok=checks_ok,
    )


def _check(id_="apogee_max", limit=1000.0, comparator="<=", ok=True) -> LaunchCheck:
    return LaunchCheck(
        id=id_, value=480.0, limit=limit, comparator=comparator,
        ok=ok, severity="hard", source="PROP-003",
    )


def _sweep() -> RailSweep:
    current = _candidate(90, 0, 388.0)
    best = _candidate(84, 270, 124.0)
    return RailSweep(
        wind=WindUsed(speed=5.0, direction_from=270.0, source="manual"),
        current=current,
        best=best,
        candidates=[best, current],
        skipped=[SkippedCandidate(inclination=80, heading=30, error="boom")],
        limits=LaunchLimits(),
        checks_current=[_check(), _check("descent_recommended", [5.0, 6.0], "between", False)],
        checks_best=[_check()],
    )


class _FakeRecommend:
    def __init__(self, result=None, error: Exception | None = None):
        self.result = result if result is not None else _sweep()
        self.error = error
        self.calls: list[dict] = []
        self.lock_held_during_call: bool | None = None

    def __call__(self, export_dir, scenario, inclinations=None, headings=None, **kw):
        self.lock_held_during_call = _SIMULATE_LOCK.locked()
        self.calls.append(
            {
                "export_dir": Path(export_dir),
                "export_files": sorted(p.name for p in Path(export_dir).iterdir()),
                "scenario": scenario,
                "inclinations": inclinations,
                "headings": headings,
                **kw,
            }
        )
        if self.error is not None:
            raise self.error
        return self.result


@pytest.fixture()
def env(tmp_path, monkeypatch):
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db, get_storage

    db = InMemoryDb()
    storage = LocalFsStorage(tmp_path / "blobs")
    (tmp_path / "blobs" / "exports" / "exp-1").mkdir(parents=True)
    (tmp_path / "blobs" / "exports" / "exp-1" / "parameters.json").write_text("{}")
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(results_dir=tmp_path / "runs")
    app.dependency_overrides[get_identity_verifier] = lambda: _verify
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_db] = lambda: db
    _seed_export(db)
    fake = _FakeRecommend()
    monkeypatch.setattr("icaro_api.routers.launchday.recommend_rail", fake)
    return TestClient(app), db, fake


def _body(**overrides) -> dict:
    body = {"export_id": "exp-1", "scenario": None}
    body.update(overrides)
    return body


def test_returns_sweep_payload_with_s5_shape(env):
    client, _, fake = env

    resp = client.post("/api/launchday", json=_body(), headers=_auth())

    assert resp.status_code == 200
    data = resp.json()
    assert set(data) == {
        "wind", "current", "best", "candidates", "skipped",
        "limits", "checks_current", "checks_best",
    }
    assert data["wind"] == {"speed": 5.0, "direction_from": 270.0, "source": "manual"}
    assert [(c["inclination"], c["heading"]) for c in data["candidates"]] == [(84, 270), (90, 0)]
    assert data["best"]["landing_distance"] == 124.0
    assert set(data["current"]) == {
        "inclination", "heading", "apogee_agl", "landing_distance", "landing_bearing",
        "out_of_rail_velocity", "stability_margin_min", "impact_velocity", "checks_ok",
    }
    assert data["skipped"] == [{"inclination": 80.0, "heading": 30.0, "error": "boom"}]
    assert data["limits"] == LaunchLimits().to_dict()
    assert data["checks_current"][1]["limit"] == [5.0, 6.0]
    assert data["checks_current"][1]["comparator"] == "between"
    assert data["checks_current"][0] == {
        "id": "apogee_max", "value": 480.0, "limit": 1000.0, "comparator": "<=",
        "ok": True, "severity": "hard", "source": "PROP-003",
    }
    assert len(data["checks_best"]) == 1
    # The export was downloaded and handed to the domain; default grid used.
    assert fake.calls[0]["export_files"] == ["parameters.json"]
    assert fake.calls[0]["scenario"] is None
    assert "inclinations" not in fake.calls[0] or fake.calls[0]["inclinations"] is None


def test_best_none_and_checks_best_none_pass_through(env):
    client, _, fake = env
    sweep = _sweep()
    fake.result = RailSweep(
        wind=sweep.wind, current=sweep.current, best=None, candidates=[],
        skipped=[], limits=sweep.limits, checks_current=[], checks_best=None,
    )

    resp = client.post("/api/launchday", json=_body(), headers=_auth())

    assert resp.status_code == 200
    assert resp.json()["best"] is None and resp.json()["checks_best"] is None


def test_grid_from_body_is_forwarded(env):
    client, _, fake = env

    resp = client.post(
        "/api/launchday",
        json=_body(inclinations=[90, 85], headings=[0, 180]),
        headers=_auth(),
    )

    assert resp.status_code == 200
    assert list(fake.calls[0]["inclinations"]) == [90.0, 85.0]
    assert list(fake.calls[0]["headings"]) == [0.0, 180.0]


def test_scenario_wind_is_parsed_and_forwarded(env):
    client, _, fake = env
    scenario = {
        "site": {"latitude": 39.39, "longitude": -8.29},
        "wind": {"speed": 5.0, "direction_from": 270.0},
    }

    resp = client.post("/api/launchday", json=_body(scenario=scenario), headers=_auth())

    assert resp.status_code == 200
    passed = fake.calls[0]["scenario"]
    assert passed.wind.speed == 5.0
    assert passed.wind.direction_from == 270.0


def test_domain_value_error_is_422_with_its_message(env):
    client, _, fake = env
    fake.error = ValueError("Inclinations must be within [70, 90] degrees, got 60.")

    resp = client.post("/api/launchday", json=_body(inclinations=[60]), headers=_auth())

    assert resp.status_code == 422
    assert resp.json()["detail"] == "Inclinations must be within [70, 90] degrees, got 60."


def test_invalid_scenario_is_422_and_domain_not_called(env):
    client, _, fake = env
    scenario = {"site": {"latitude": 999.0, "longitude": 0.0}}

    resp = client.post("/api/launchday", json=_body(scenario=scenario), headers=_auth())

    assert resp.status_code == 422
    assert any("latitude" in e["field"] for e in resp.json()["detail"])
    assert fake.calls == []


def test_other_orgs_export_is_404(env):
    client, db, fake = env
    _seed_export(db, export_id="exp-other", org_id=_OTHER_ORG)

    resp = client.post("/api/launchday", json=_body(export_id="exp-other"), headers=_auth())

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Export 'exp-other' not found."
    assert fake.calls == []


def test_missing_export_is_404(env):
    client, _, _ = env

    resp = client.post("/api/launchday", json=_body(export_id="nope"), headers=_auth())

    assert resp.status_code == 404
    assert resp.json()["detail"] == "Export 'nope' not found."


def test_unauthenticated_is_401(env):
    client, _, fake = env

    resp = client.post("/api/launchday", json=_body())

    assert resp.status_code == 401
    assert fake.calls == []


def test_does_not_take_the_simulate_lock(env):
    client, _, fake = env

    resp = client.post("/api/launchday", json=_body(), headers=_auth())

    assert resp.status_code == 200
    assert fake.lock_held_during_call is False
    import icaro_api.routers.launchday as launchday_router

    assert not hasattr(launchday_router, "_SIMULATE_LOCK")


def test_endpoint_is_in_openapi_with_typed_response(env):
    client, _, _ = env

    spec = client.get("/openapi.json").json()

    op = spec["paths"]["/api/launchday"]["post"]
    ref = op["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/LaunchDayResponse")
    for name in (
        "LaunchDayRequest", "WindUsedModel", "RailCandidateModel",
        "SkippedCandidateModel", "LaunchCheckModel", "LaunchLimitsModel",
    ):
        assert name in spec["components"]["schemas"]
