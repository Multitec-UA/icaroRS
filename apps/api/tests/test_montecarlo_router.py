"""Tests for the Monte Carlo job endpoints under /api/montecarlo (S9, S10).

The job queue is overridden with an ``autostart=False`` queue so submitted
runs stay ``queued`` until a test drives them with ``process_next()``; its
launcher is a fake process (no subprocess, no Monte Carlo).
"""

from __future__ import annotations

from dataclasses import replace
from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.services.db import ExportRecord, InMemoryDb
from icaro_api.services.montecarlo_jobs import MonteCarloJobQueue
from icaro_api.services.storage import LocalFsStorage
from tests.fakes import FakeMonteCarloProcess, fake_montecarlo_result, make_montecarlo_record

_COOKIE = "test-session-token"
_ORG = "test-org"
_OTHER_ORG = "other-org"


def _verify(cookie: str) -> dict:
    if cookie != _COOKIE:
        raise ValueError("invalid session cookie")
    return {"uid": "test", "org_id": _ORG}


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_COOKIE}"}


def _seed_export(db, export_id="exp-1", org_id=_ORG, rocket_id="rk-1"):
    db.save_export(
        ExportRecord(
            export_id=export_id,
            rocket_id=rocket_id,
            name="TestRocket",
            created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
            created_by="test",
            org_id=org_id,
            export_prefix=f"exports/{export_id}/",
        ),
        org_id=org_id,
    )


@pytest.fixture()
def env(tmp_path):
    from icaro_api.config import Settings, get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db, get_job_queue, get_storage

    db = InMemoryDb()
    storage = LocalFsStorage(tmp_path / "blobs")
    (tmp_path / "blobs" / "exports" / "exp-1").mkdir(parents=True)
    (tmp_path / "blobs" / "exports" / "exp-1" / "parameters.json").write_text("{}")
    queue = MonteCarloJobQueue(
        tmp_path / "runs",
        launcher=lambda argv, err: FakeMonteCarloProcess(argv, err),
        sleep=lambda s: None,
        autostart=False,
    )
    app = create_app()
    app.dependency_overrides[get_settings] = lambda: Settings(results_dir=tmp_path / "runs")
    app.dependency_overrides[get_identity_verifier] = lambda: _verify
    app.dependency_overrides[get_storage] = lambda: storage
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_job_queue] = lambda: queue
    _seed_export(db)
    return TestClient(app), db, queue, storage


def _body(n=10, export_id="exp-1", scenario=None):
    return {"export_id": export_id, "n": n, "scenario": scenario}


def test_submit_returns_202_and_records_queued(env):
    client, db, queue, _ = env

    resp = client.post("/api/montecarlo", json=_body(n=20), headers=_auth())

    assert resp.status_code == 202
    data = resp.json()
    assert data["status"] == "queued" and data["queue_position"] == 0
    rec = db.get_montecarlo(data["run_id"], org_id=_ORG)
    assert rec.status == "queued" and rec.n == 20 and rec.progress_total == 20
    assert rec.rocket_id == "rk-1" and rec.export_id == "exp-1" and rec.created_by == "test"

    second = client.post("/api/montecarlo", json=_body(), headers=_auth()).json()
    assert second["queue_position"] == 1


def test_submit_validates_scenario_like_simulate(env):
    client, *_ = env
    scenario = {"site": {"latitude": 999.0, "longitude": 0.0}}

    resp = client.post("/api/montecarlo", json=_body(scenario=scenario), headers=_auth())

    assert resp.status_code == 422
    assert any("latitude" in e["field"] for e in resp.json()["detail"])


@pytest.mark.parametrize("n", [9, 501])
def test_submit_rejects_n_out_of_range(env, n):
    client, db, *_ = env

    resp = client.post("/api/montecarlo", json=_body(n=n), headers=_auth())

    assert resp.status_code == 422
    assert resp.json()["detail"][0]["message"] == f"n must be between 10 and 500, got {n}."
    assert db.list_montecarlo(_ORG) == []


def test_submit_bounds_come_from_settings(env, tmp_path):
    client, *_ = env
    from icaro_api.config import Settings, get_settings

    client.app.dependency_overrides[get_settings] = lambda: Settings(
        results_dir=tmp_path / "runs", montecarlo_max_n=50
    )
    assert client.post("/api/montecarlo", json=_body(n=51), headers=_auth()).status_code == 422


def test_submit_other_org_export_is_404(env):
    client, db, *_ = env
    _seed_export(db, export_id="exp-other", org_id=_OTHER_ORG)

    for export_id in ("exp-other", "missing"):
        resp = client.post("/api/montecarlo", json=_body(export_id=export_id), headers=_auth())
        assert resp.status_code == 404
        assert resp.json()["detail"] == f"Export '{export_id}' not found."


def test_requires_auth(env):
    client, *_ = env
    assert client.post("/api/montecarlo", json=_body()).status_code == 401
    assert client.get("/api/montecarlo").status_code == 401


def test_get_status_shape_queued_then_done(env):
    client, db, queue, _ = env
    first = client.post("/api/montecarlo", json=_body(), headers=_auth()).json()["run_id"]
    second = client.post("/api/montecarlo", json=_body(), headers=_auth()).json()["run_id"]

    data = client.get(f"/api/montecarlo/{second}", headers=_auth()).json()
    assert data == {
        "run_id": second,
        "rocket_id": "rk-1",
        "export_id": "exp-1",
        "created_at": data["created_at"],
        "created_by": "test",
        "n": 10,
        "status": "queued",
        "progress": {"done": 0, "total": 10},
        "queue_position": 1,
        "result": None,
        "error": None,
        "finished_at": None,
    }

    queue.process_next()
    done = client.get(f"/api/montecarlo/{first}", headers=_auth()).json()
    assert done["status"] == "done" and done["queue_position"] is None
    assert done["progress"] == {"done": 10, "total": 10}
    assert done["result"]["apogee_stats"]["p50"] == 805.0
    assert done["result"]["landing_ellipses"] == [[[38.1, -0.5], [38.2, -0.6]]]
    assert client.get(f"/api/montecarlo/{second}", headers=_auth()).json()["queue_position"] == 0


def test_get_status_other_org_or_missing_is_404(env):
    client, db, *_ = env
    db.save_montecarlo(make_montecarlo_record("mc-x", org_id=_OTHER_ORG), org_id=_OTHER_ORG)
    assert client.get("/api/montecarlo/mc-x", headers=_auth()).status_code == 404
    assert client.get("/api/montecarlo/nope", headers=_auth()).status_code == 404


def test_list_is_newest_first_filtered_by_rocket_without_result(env):
    client, db, *_ = env
    for rid, rocket, day in (("a", "rk-1", 1), ("b", "rk-2", 2), ("c", "rk-1", 3)):
        db.save_montecarlo(
            make_montecarlo_record(rid, org_id=_ORG, rocket_id=rocket,
                                   created_at=datetime(2026, 2, day, tzinfo=timezone.utc)),
            org_id=_ORG,
        )
    db.save_montecarlo(make_montecarlo_record("o", org_id=_OTHER_ORG), org_id=_OTHER_ORG)

    rows = client.get("/api/montecarlo", headers=_auth()).json()
    assert [r["run_id"] for r in rows] == ["c", "b", "a"]
    assert all("result" not in r for r in rows)

    rows = client.get("/api/montecarlo?rocket_id=rk-1&limit=1", headers=_auth()).json()
    assert [r["run_id"] for r in rows] == ["c"]


def test_kml_404_before_done_then_served(env):
    client, db, queue, _ = env
    run_id = client.post("/api/montecarlo", json=_body(), headers=_auth()).json()["run_id"]

    assert client.get(f"/api/montecarlo/{run_id}/kml", headers=_auth()).status_code == 404

    queue.process_next()
    resp = client.get(f"/api/montecarlo/{run_id}/kml", headers=_auth())
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/vnd.google-earth.kml+xml")
    assert resp.content == b"<kml/>"


def test_kml_404_when_done_without_kml(env):
    client, db, *_ = env
    from tests.fakes import fake_montecarlo_result

    rec = make_montecarlo_record("mc-nokml", org_id=_ORG, status="done",
                                 result=fake_montecarlo_result(kml=None),
                                 result_prefix=f"orgs/{_ORG}/montecarlo/mc-nokml/")
    db.save_montecarlo(rec, org_id=_ORG)
    assert client.get("/api/montecarlo/mc-nokml/kml", headers=_auth()).status_code == 404


def test_startup_marks_unfinished_runs_as_error(env):
    client, db, *_ = env
    db.save_montecarlo(make_montecarlo_record("q", org_id=_ORG, status="queued"), org_id=_ORG)
    db.save_montecarlo(make_montecarlo_record("r", org_id=_ORG, status="running"), org_id=_ORG)
    db.save_montecarlo(make_montecarlo_record("d", org_id=_ORG, status="done"), org_id=_ORG)

    with TestClient(client.app):  # runs the lifespan (startup)
        pass

    for rid in ("q", "r"):
        rec = db.get_montecarlo(rid, org_id=_ORG)
        assert rec.status == "error" and rec.error == "interrupted by an API restart"
    assert db.get_montecarlo("d", org_id=_ORG).status == "done"


def test_openapi_lists_the_montecarlo_paths(env):
    client, *_ = env
    paths = client.app.openapi()["paths"]
    assert {"/api/montecarlo", "/api/montecarlo/{run_id}", "/api/montecarlo/{run_id}/kml"} <= set(paths)


def test_done_result_exposes_the_uncertainty_budget(env):
    """S15: the stored result carries the dispersed budget and the API returns it."""
    client, db, _queue, _ = env
    rec = make_montecarlo_record("mc-u", org_id=_ORG, n=10)
    result = fake_montecarlo_result()
    result["uncertainty"] = {"mass": {"std": 0.05, "kind": "relative"}}
    db.save_montecarlo(replace(rec, status="done", result=result), org_id=_ORG)

    body = client.get("/api/montecarlo/mc-u", headers=_auth()).json()

    assert body["result"]["uncertainty"] == {"mass": {"std": 0.05, "kind": "relative"}}


def test_done_result_without_uncertainty_is_still_served(env):
    """Runs stored before S15 have no budget: the field defaults to empty."""
    client, db, _queue, _ = env
    rec = make_montecarlo_record("mc-old", org_id=_ORG, n=10)
    db.save_montecarlo(replace(rec, status="done", result=fake_montecarlo_result()), org_id=_ORG)

    body = client.get("/api/montecarlo/mc-old", headers=_auth()).json()

    assert body["result"]["uncertainty"] == {}
