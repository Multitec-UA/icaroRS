"""Real flight interop: settings, store adapters, publish-on-simulate, routes, backfill.

All fakes: InMemoryDb, LocalFsStorage on tmp_path, InMemoryInteropStore and a
MagicMock Firestore client. No network, no JVM, no rocketpy simulation.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient
from icaro import INTEROP_REAL_FLIGHT_SCHEMA, INTEROP_SIMULATION_SCHEMA

from icaro_api.auth import SESSION_COOKIE_NAME, get_identity_verifier
from icaro_api.config import Settings
from icaro_api.services.db import ExportRecord, InMemoryDb, RocketRecord, SimRecord
from icaro_api.services.interop import (
    REAL_FLIGHT_SUMMARY_FIELDS,
    FirestoreInteropStore,
    InMemoryInteropStore,
    build_simulation_doc,
    interop_org_ids,
    launch_date_from_scenario,
    load_run_payload,
    motor_label,
    publish_simulation_safely,
)
from icaro_api.services.storage import LocalFsStorage

_COOKIE = "test-session-token"
_ORG = "org-multitec"
_OTHER = "org-other"
_T0 = datetime(2026, 10, 18, 10, tzinfo=timezone.utc)


def _verifier(org_id: str):
    def verify(cookie: str) -> dict:
        if cookie != _COOKIE:
            raise ValueError("bad cookie")
        return {"uid": "u1", "org_id": org_id}

    return verify


def _auth() -> dict:
    return {"Cookie": f"{SESSION_COOKIE_NAME}={_COOKIE}"}


def _real_doc(flight_id: str = "MT1-00279-9a1a6300", updated: datetime | None = None, **overrides) -> dict:
    ts = [i * 0.5 for i in range(61)]
    alt = [max(0.0, 90.0 * t - 4.9 * t * t) if t <= 10 else max(0.0, 459.0 - 4.0 * (t - 10)) for t in ts]
    doc = {
        "schema": INTEROP_REAL_FLIGHT_SCHEMA,
        "flight_id": flight_id,
        "device_id": "mt1-a",
        "rocket": "MT1",
        "launch_utc": "2026-10-18T10:12:00Z",
        "pad": {"lat": 41.7299, "lon": 0.1042, "elev_m": 233.0},
        "events": [
            {"id": "liftoff", "t": 0.0, "label": "Liftoff", "source": "fsm"},
            {"id": "apogee", "t": 10.05, "label": "Apogee", "source": "fsm"},
            {"id": "ejection", "t": 16.06, "label": "Ejection", "source": "fsm"},
            {"id": "deploy", "t": 17.5, "label": "Chute open", "source": "derived"},
            {"id": "mystery", "t": 1.0, "label": "?", "source": "fsm"},
        ],
        "stats": {"apogee_m": 459.0, "apogee_t": 10.05, "vmax_ms": 95.0, "amax_ms2": 70.0, "landing_t": 30.0},
        "series": {"t": ts, "alt_m": alt, "vz_ms": [0.0] * len(ts), "acc_ms2": [9.8] * len(ts)},
        "rate_hz": 2,
        "source_samples": 250000,
        "server_version": "0.40.0",
        "updated_at": updated or _T0,
    }
    doc.update(overrides)
    return doc


def _payload() -> dict:
    ts = [i * 0.25 for i in range(121)]
    return {
        "site": {"lat": 41.7299, "lon": 0.1042, "elev_m": 233.0},
        "events": [
            {"id": "liftoff", "t": 0.0, "label": "Liftoff"},
            {"id": "apogee", "t": 11.1, "label": "Apogee"},
            {"id": "deploy", "t": 14.0, "label": "Deploy: Main"},
            {"id": "landing", "t": 30.0, "label": "Landing"},
        ],
        "stats": {"apogee_m": 571.4, "apogee_t": 11.1, "vmax_ms": 111.5, "amax_ms2": 108.0, "flight_time_s": 30.0},
        "series": {
            "t": ts,
            "alt_m": [max(0.0, 100.0 * t - 4.5 * t * t) for t in ts],
            "vz_ms": [1.0] * len(ts),
            "speed_ms": [1.0] * len(ts),
            "acc_ms2": [9.8] * len(ts),
            "x_m": [0.0] * len(ts),
            "y_m": [0.0] * len(ts),
        },
    }


def _seed(db: InMemoryDb, run_id: str = "run-1", org_id: str = _ORG, created: datetime | None = None) -> SimRecord:
    db.save_rocket(
        RocketRecord(rocket_id="rk-1", name="MT1", created_at=_T0, created_by="u1", org_id=org_id), org_id=org_id
    )
    db.save_export(
        ExportRecord(
            export_id="exp-1",
            rocket_id="rk-1",
            name="MT1",
            created_at=_T0,
            created_by="u1",
            org_id=org_id,
            export_prefix=f"orgs/{org_id}/exports/exp-1/",
            ork_filename="MT1-v1.7.1.ork",
        ),
        org_id=org_id,
    )
    sim = SimRecord(
        simulation_id=run_id,
        rocket_id="rk-1",
        export_id="exp-1",
        scenario={
            "site": {"latitude": 41.7299, "longitude": 0.1042, "elevation": 233.0},
            "launch_date": {"year": 2026, "month": 10, "day": 18, "hour": 10},
        },
        created_at=created or _T0,
        created_by="u1",
        org_id=org_id,
        status="done",
        scalars={"apogee_m": 571.4, "apogee_time_s": 11.1, "flight_time_s": 30.0, "max_velocity_ms": 111.5},
        result_prefix=f"orgs/{org_id}/results/{run_id}/",
    )
    db.save_simulation(sim, org_id=org_id)
    return sim


def _put_blob(root: Path, key: str, data) -> None:
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))


def _client(*, org_id: str = _ORG, interop_orgs: str = _ORG, db=None, storage=None, store=None, tmp_path=None):
    from icaro_api.config import get_settings
    from icaro_api.main import create_app
    from icaro_api.runs import get_db, get_interop_store, get_storage

    app = create_app()
    settings = Settings(interop_orgs=interop_orgs, results_dir=(tmp_path or Path(".")) / "runs")
    app.dependency_overrides[get_settings] = lambda: settings
    app.dependency_overrides[get_identity_verifier] = lambda: _verifier(org_id)
    app.dependency_overrides[get_db] = lambda: db if db is not None else InMemoryDb()
    app.dependency_overrides[get_storage] = lambda: storage if storage is not None else MagicMock()
    app.dependency_overrides[get_interop_store] = lambda: store if store is not None else InMemoryInteropStore()
    return TestClient(app, raise_server_exceptions=True)


# ---------------------------------------------------------------------------
# Settings and helpers
# ---------------------------------------------------------------------------


class TestSettings:
    def test_org_ids_parse_comma_separated(self):
        assert interop_org_ids(" a, b ,,c ") == frozenset({"a", "b", "c"})
        assert interop_org_ids("") == frozenset()
        assert interop_org_ids(None) == frozenset()

    def test_enabled_only_for_listed_orgs(self, monkeypatch):
        monkeypatch.setenv("ICARO_INTEROP_ORGS", "org-a,org-b")
        settings = Settings()
        assert settings.interop_enabled_for("org-a")
        assert not settings.interop_enabled_for("org-c")
        assert not settings.interop_enabled_for("")

    def test_off_when_unset(self, monkeypatch):
        monkeypatch.delenv("ICARO_INTEROP_ORGS", raising=False)
        assert not Settings().interop_enabled_for("org-a")


class TestDocHelpers:
    def test_motor_label(self):
        params = {"motors": {"identity": {"designation": "232H123-14A", "manufacturer": "Cesaroni Technology"}}}
        assert motor_label(params) == "Cesaroni Technology 232H123-14A"
        assert motor_label({"motors": {}}) is None
        assert motor_label(None) is None

    def test_launch_date(self):
        assert launch_date_from_scenario({"launch_date": {"year": 2026, "month": 10, "day": 18, "hour": 9}}) == (
            "2026-10-18T09:00:00Z"
        )
        assert launch_date_from_scenario({}) is None
        assert launch_date_from_scenario({"launch_date": {"year": 2026}}) is None

    def test_build_simulation_doc_follows_schema_v1(self):
        db = InMemoryDb()
        sim = _seed(db)
        now = _T0 + timedelta(hours=1)
        doc = build_simulation_doc(
            _payload(), sim=sim, rocket_name="MT1", export_label="MT1-v1.7.1.ork", motor="CTI 232H", now=now
        )
        assert doc["schema"] == INTEROP_SIMULATION_SCHEMA
        assert set(doc) == {
            "schema", "simulation_id", "org_id", "rocket_id", "rocket_name", "export_id", "export_label",
            "site", "launch_date", "motor", "events", "stats", "series", "created_at", "updated_at",
        }
        assert doc["simulation_id"] == "run-1" and doc["org_id"] == _ORG
        assert doc["launch_date"] == "2026-10-18T10:00:00Z"
        assert doc["created_at"] == _T0 and doc["updated_at"] == now
        assert "approximate" not in doc

    def test_publish_safely_never_raises(self):
        store = MagicMock()
        store.publish_simulation.side_effect = RuntimeError("firestore down")
        sim = _seed(InMemoryDb())
        assert publish_simulation_safely(store, _payload(), sim=sim, rocket_name=None, export_label=None, motor=None) is False


class TestLoadRunPayload:
    def test_prefers_interop_artifact(self, tmp_path):
        sim = _seed(InMemoryDb())
        _put_blob(tmp_path, f"{sim.result_prefix}interop.json", _payload())
        payload = load_run_payload(LocalFsStorage(tmp_path), sim)
        assert "approximate" not in payload and payload["stats"]["apogee_m"] == 571.4

    def test_falls_back_to_series_json(self, tmp_path):
        sim = _seed(InMemoryDb())
        ts = [float(i) for i in range(31)]
        _put_blob(tmp_path, f"{sim.result_prefix}series.json", {"t": ts, "altitude": [10.0 * t for t in ts]})
        payload = load_run_payload(LocalFsStorage(tmp_path), sim)
        assert payload["approximate"] is True
        assert payload["site"] == {"lat": 41.7299, "lon": 0.1042, "elev_m": 233.0}

    def test_nothing_stored(self, tmp_path):
        sim = _seed(InMemoryDb())
        with pytest.raises(LookupError):
            load_run_payload(LocalFsStorage(tmp_path), sim)


# ---------------------------------------------------------------------------
# Store adapters
# ---------------------------------------------------------------------------


class TestInMemoryStore:
    def test_lists_summaries_newest_first(self):
        store = InMemoryInteropStore()
        store.put_real_flight(_real_doc("old", updated=_T0))
        store.put_real_flight(_real_doc("new", updated=_T0 + timedelta(days=1)))
        store.put_real_flight({k: v for k, v in _real_doc("no-ts").items() if k != "updated_at"})
        rows = store.list_real_flights()
        assert [r["flight_id"] for r in rows] == ["new", "old"]
        assert "series" not in rows[0] and set(rows[0]) <= set(REAL_FLIGHT_SUMMARY_FIELDS)

    def test_get_and_publish(self):
        store = InMemoryInteropStore()
        store.put_real_flight(_real_doc("f1"))
        assert store.get_real_flight("f1")["flight_id"] == "f1"
        assert store.get_real_flight("nope") is None
        store.publish_simulation({"simulation_id": "s1"})
        assert store.simulations == {"s1": {"simulation_id": "s1"}}


class TestFirestoreStore:
    def test_publish_upserts_by_simulation_id(self):
        client = MagicMock()
        store = FirestoreInteropStore("p", client=client)
        store.publish_simulation({"simulation_id": "s1", "schema": INTEROP_SIMULATION_SCHEMA})
        client.collection.assert_called_with("interop_simulations")
        client.collection.return_value.document.assert_called_with("s1")
        client.collection.return_value.document.return_value.set.assert_called_once()

    def test_list_orders_by_updated_at_only_and_selects_summary(self):
        client = MagicMock()
        col = client.collection.return_value
        ordered = col.order_by.return_value
        selected = ordered.select.return_value
        snap = MagicMock()
        snap.id = "f1"
        snap.to_dict.return_value = {"rocket": "MT1", "updated_at": _T0}
        selected.limit.return_value.stream.return_value = [snap]

        rows = FirestoreInteropStore("p", client=client).list_real_flights(limit=10)

        client.collection.assert_called_with("interop_real_flights")
        col.order_by.assert_called_once_with("updated_at", direction="DESCENDING")
        col.where.assert_not_called()  # no composite index needed
        ordered.select.assert_called_once_with(list(REAL_FLIGHT_SUMMARY_FIELDS))
        selected.limit.assert_called_once_with(10)
        assert rows == [{"rocket": "MT1", "updated_at": _T0, "flight_id": "f1"}]

    def test_get_missing_and_present(self):
        client = MagicMock()
        doc_ref = client.collection.return_value.document.return_value
        doc_ref.get.return_value.exists = False
        store = FirestoreInteropStore("p", client=client)
        assert store.get_real_flight("x") is None
        doc_ref.get.return_value.exists = True
        doc_ref.get.return_value.id = "x"
        doc_ref.get.return_value.to_dict.return_value = {"schema": INTEROP_REAL_FLIGHT_SCHEMA}
        assert store.get_real_flight("x") == {"schema": INTEROP_REAL_FLIGHT_SCHEMA, "flight_id": "x"}

    def test_client_is_lazy(self):
        with patch.dict("sys.modules", {"google.cloud.firestore": None}):
            FirestoreInteropStore("p")  # no import, no client until first use


class TestAdapterSelection:
    def test_in_memory_without_project(self):
        from icaro_api import runs

        runs._inmemory_interop = None
        store = runs.get_interop_store(Settings(firestore_project=None))
        assert isinstance(store, InMemoryInteropStore)
        assert runs.get_interop_store(Settings(firestore_project=None)) is store
        runs._inmemory_interop = None

    def test_firestore_with_project(self):
        from icaro_api import runs

        store = runs.get_interop_store(Settings(firestore_project="multitecweb"))
        assert isinstance(store, FirestoreInteropStore)


# ---------------------------------------------------------------------------
# POST /api/simulate publishes for allowed orgs
# ---------------------------------------------------------------------------


def _simulate(client: TestClient, tmp_path: Path, *, write_interop: bool = True):
    from tests.fakes import FakeFlight

    def fake_serialize(flight, run_dir, run_id, captured_warnings):
        out = run_dir / run_id
        out.mkdir(parents=True, exist_ok=True)
        if write_interop:
            (out / "interop.json").write_text(json.dumps(_payload()))
        return {"run_id": run_id, "scalars": {"apogee_m": 571.4}, "plot_urls": [], "warnings": []}

    with (
        patch("icaro_api.routers.simulate.simulate_from_export", return_value=FakeFlight()),
        patch("icaro_api.routers.simulate.serialize_flight", side_effect=fake_serialize),
    ):
        return client.post(
            "/api/simulate",
            json={"export_id": "exp-1", "scenario": {"site": {"latitude": 41.7299, "longitude": 0.1042}}},
            headers=_auth(),
        )


class TestPublishOnSimulate:
    def _setup(self, tmp_path, org_id=_ORG):
        db = InMemoryDb()
        _seed(db, org_id=org_id)
        storage = MagicMock(spec=LocalFsStorage)
        store = InMemoryInteropStore()
        return db, storage, store

    def test_publishes_for_allowed_org(self, tmp_path):
        db, storage, store = self._setup(tmp_path)
        client = _client(db=db, storage=storage, store=store, tmp_path=tmp_path)
        resp = _simulate(client, tmp_path)
        assert resp.status_code == 200
        run_id = resp.json()["run_id"]
        doc = store.simulations[run_id]
        assert doc["schema"] == INTEROP_SIMULATION_SCHEMA
        assert doc["rocket_name"] == "MT1" and doc["export_label"] == "MT1-v1.7.1.ork"
        assert doc["org_id"] == _ORG and doc["stats"]["apogee_m"] == 571.4
        assert db.get_simulation(run_id, org_id=_ORG).artifact_refs["interop_json"].endswith("interop.json")

    def test_does_not_publish_for_other_orgs_or_when_off(self, tmp_path):
        for interop_orgs in ("", "someone-else"):
            db, storage, store = self._setup(tmp_path)
            client = _client(db=db, storage=storage, store=store, interop_orgs=interop_orgs, tmp_path=tmp_path)
            assert _simulate(client, tmp_path).status_code == 200
            assert store.simulations == {}

    def test_publish_failure_never_fails_the_run(self, tmp_path):
        db, storage, _ = self._setup(tmp_path)
        store = MagicMock()
        store.publish_simulation.side_effect = RuntimeError("firestore down")
        client = _client(db=db, storage=storage, store=store, tmp_path=tmp_path)
        assert _simulate(client, tmp_path).status_code == 200
        store.publish_simulation.assert_called_once()

    def test_missing_payload_skips_publishing(self, tmp_path):
        db, storage, store = self._setup(tmp_path)
        client = _client(db=db, storage=storage, store=store, tmp_path=tmp_path)
        assert _simulate(client, tmp_path, write_interop=False).status_code == 200
        assert store.simulations == {}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


class TestRealFlightRoutes:
    def test_list_reports_disabled_when_off(self, tmp_path):
        store = InMemoryInteropStore()
        store.put_real_flight(_real_doc())
        for interop_orgs in ("", _OTHER):
            client = _client(interop_orgs=interop_orgs, store=store, tmp_path=tmp_path)
            assert client.get("/api/real-flights", headers=_auth()).json() == {"enabled": False, "flights": []}

    def test_list_summaries_when_enabled(self, tmp_path):
        store = InMemoryInteropStore()
        store.put_real_flight(_real_doc("a", updated=_T0))
        store.put_real_flight(_real_doc("b", updated=_T0 + timedelta(days=2)))
        body = _client(store=store, tmp_path=tmp_path).get("/api/real-flights", headers=_auth()).json()
        assert body["enabled"] is True
        assert [f["flight_id"] for f in body["flights"]] == ["b", "a"]
        first = body["flights"][0]
        assert first["stats"]["apogee_m"] == 459.0 and first["rocket"] == "MT1"
        assert first["updated_at"].startswith("2026-10-20T10:00:00")
        assert "series" not in first

    def test_requires_auth(self, tmp_path):
        client = _client(tmp_path=tmp_path)
        assert client.get("/api/real-flights").status_code == 401

    def test_detail(self, tmp_path):
        store = InMemoryInteropStore()
        store.put_real_flight(_real_doc())
        client = _client(store=store, tmp_path=tmp_path)
        body = client.get("/api/real-flights/MT1-00279-9a1a6300", headers=_auth()).json()
        assert body["schema"] == INTEROP_REAL_FLIGHT_SCHEMA
        assert len(body["series"]["t"]) == 61 and body["source_samples"] == 250000
        assert client.get("/api/real-flights/nope", headers=_auth()).status_code == 404

    def test_detail_404_when_off(self, tmp_path):
        store = InMemoryInteropStore()
        store.put_real_flight(_real_doc())
        client = _client(interop_orgs="", store=store, tmp_path=tmp_path)
        assert client.get("/api/real-flights/MT1-00279-9a1a6300", headers=_auth()).status_code == 404


class TestCompareRoute:
    URL = "/api/results/run-1/compare/MT1-00279-9a1a6300"

    def _env(self, tmp_path, *, interop=True, series=False):
        db = InMemoryDb()
        sim = _seed(db)
        if interop:
            _put_blob(tmp_path / "blobs", f"{sim.result_prefix}interop.json", _payload())
        if series:
            ts = [float(i) for i in range(31)]
            _put_blob(
                tmp_path / "blobs",
                f"{sim.result_prefix}series.json",
                {"t": ts, "altitude": [max(0.0, 100.0 * t - 4.5 * t * t) for t in ts]},
            )
        store = InMemoryInteropStore()
        store.put_real_flight(_real_doc())
        return db, LocalFsStorage(tmp_path / "blobs"), store

    def test_compares_from_the_stored_payload(self, tmp_path):
        db, storage, store = self._env(tmp_path)
        resp = _client(db=db, storage=storage, store=store, tmp_path=tmp_path).get(self.URL, headers=_auth())
        assert resp.status_code == 200
        body = resp.json()
        assert body["run_id"] == "run-1" and body["flight_id"] == "MT1-00279-9a1a6300"
        assert body["approximate"] is False
        assert body["real_flight"]["rocket"] == "MT1"
        assert set(body["series"]) == {"t", "sim", "real"}
        assert len(body["series"]["sim"]["alt_m"]) == len(body["series"]["t"])
        kpis = {k["id"]: k for k in body["kpis"]}
        assert kpis["apogee_m"]["delta"] == pytest.approx(112.4)
        assert {e["id"] for e in body["events"]} >= {"apogee", "ejection", "deploy"}
        assert "mystery" not in {e["id"] for e in body["events"]}
        assert "single_deploy" in {w["code"] for w in body["warnings"]}
        assert body["rmse"]["alt_m"] is not None
        assert body["window"] == {"t_start": 0.0, "t_end": 30.0}

    def test_old_run_compares_approximately(self, tmp_path):
        db, storage, store = self._env(tmp_path, interop=False, series=True)
        body = _client(db=db, storage=storage, store=store, tmp_path=tmp_path).get(self.URL, headers=_auth()).json()
        assert body["approximate"] is True
        assert "sim_approximate" in {w["code"] for w in body["warnings"]}

    def test_run_without_stored_data_is_404(self, tmp_path):
        db, storage, store = self._env(tmp_path, interop=False)
        resp = _client(db=db, storage=storage, store=store, tmp_path=tmp_path).get(self.URL, headers=_auth())
        assert resp.status_code == 404
        assert "no stored flight series" in resp.json()["detail"]

    def test_other_orgs_run_is_404(self, tmp_path):
        db, storage, store = self._env(tmp_path)
        client = _client(org_id=_OTHER, interop_orgs=f"{_ORG},{_OTHER}", db=db, storage=storage, store=store, tmp_path=tmp_path)
        assert client.get(self.URL, headers=_auth()).status_code == 404

    def test_off_is_404(self, tmp_path):
        db, storage, store = self._env(tmp_path)
        client = _client(interop_orgs="", db=db, storage=storage, store=store, tmp_path=tmp_path)
        assert client.get(self.URL, headers=_auth()).status_code == 404

    def test_unknown_flight_is_404(self, tmp_path):
        db, storage, store = self._env(tmp_path)
        client = _client(db=db, storage=storage, store=store, tmp_path=tmp_path)
        assert client.get("/api/results/run-1/compare/nope", headers=_auth()).status_code == 404

    def test_wrong_real_schema_is_422(self, tmp_path):
        db, storage, store = self._env(tmp_path)
        store.put_real_flight(_real_doc(schema="mt-interop/real-flight@9"))
        resp = _client(db=db, storage=storage, store=store, tmp_path=tmp_path).get(self.URL, headers=_auth())
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Serialization writes the interop artefact
# ---------------------------------------------------------------------------


def test_serialize_writes_interop_json(tmp_path):
    from icaro_api.serialize import serialize_flight
    from tests.fakes import FakeFlight

    serialize_flight(FakeFlight(), run_dir=tmp_path, run_id="r1", captured_warnings=[])
    payload = json.loads((tmp_path / "r1" / "interop.json").read_text())
    assert set(payload) == {"site", "events", "stats", "series"}
    assert payload["series"]["t"][0] == 0.0 and len(payload["series"]["t"]) == 2000
    assert {"alt_m", "speed_ms", "x_m", "y_m"} <= set(payload["series"])


def test_serialize_survives_an_interop_failure(tmp_path):
    from icaro_api.serialize import serialize_flight
    from tests.fakes import FakeFlight

    with patch("icaro.interop_simulation_payload", side_effect=RuntimeError("boom")):
        result = serialize_flight(FakeFlight(), run_dir=tmp_path, run_id="r2", captured_warnings=[])
    assert result["run_id"] == "r2"
    assert not (tmp_path / "r2" / "interop.json").exists()


# ---------------------------------------------------------------------------
# Backfill script
# ---------------------------------------------------------------------------


class TestBackfill:
    def _env(self, tmp_path):
        db = InMemoryDb()
        _seed(db, "run-new", created=_T0 + timedelta(days=1))
        _seed(db, "run-old", created=_T0)
        failed = _seed(db, "run-failed", created=_T0 - timedelta(days=1))
        failed.status = "error"
        _seed(db, "run-empty", created=_T0 - timedelta(days=2))
        root = tmp_path / "blobs"
        _put_blob(root, f"orgs/{_ORG}/results/run-new/interop.json", _payload())
        ts = [float(i) for i in range(31)]
        _put_blob(root, f"orgs/{_ORG}/results/run-old/series.json", {"t": ts, "altitude": [t for t in ts]})
        _put_blob(
            root,
            f"orgs/{_ORG}/exports/exp-1/parameters.json",
            {"motors": {"identity": {"designation": "232H123-14A", "manufacturer": "Cesaroni Technology"}}},
        )
        return db, LocalFsStorage(root), InMemoryInteropStore()

    def test_dry_run_writes_nothing(self, tmp_path):
        from icaro_api.scripts.publish_interop_simulations import publish_org

        db, storage, store = self._env(tmp_path)
        report = publish_org(db, storage, store, _ORG)
        assert (report.scanned, report.published, report.approximate) == (4, 2, 1)
        assert len(report.skipped) == 2
        assert store.simulations == {}

    def test_apply_is_idempotent(self, tmp_path):
        from icaro_api.scripts.publish_interop_simulations import publish_org

        db, storage, store = self._env(tmp_path)
        publish_org(db, storage, store, _ORG, apply=True)
        first = {k: {kk: vv for kk, vv in v.items() if kk != "updated_at"} for k, v in store.simulations.items()}
        publish_org(db, storage, store, _ORG, apply=True)
        second = {k: {kk: vv for kk, vv in v.items() if kk != "updated_at"} for k, v in store.simulations.items()}
        assert first == second and set(first) == {"run-new", "run-old"}
        assert first["run-new"]["motor"] == "Cesaroni Technology 232H123-14A"
        assert first["run-old"]["approximate"] is True

    def test_limit(self, tmp_path):
        from icaro_api.scripts.publish_interop_simulations import publish_org

        db, storage, store = self._env(tmp_path)
        assert publish_org(db, storage, store, _ORG, limit=1).scanned == 1

    def test_main_refuses_orgs_outside_the_list(self, monkeypatch, capsys):
        from icaro_api.scripts.publish_interop_simulations import main

        monkeypatch.setenv("ICARO_INTEROP_ORGS", _ORG)
        assert main(["--org-id", _OTHER]) == 2
        monkeypatch.setenv("ICARO_INTEROP_ORGS", "")
        assert main([]) == 1
        assert "off" in capsys.readouterr().out
