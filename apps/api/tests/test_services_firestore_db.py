"""Contract tests for FirestoreDb adapter — T-42.

TDD: T-42 (RED) written first; T-43 (GREEN) fixes any FirestoreDb bugs.
Req: Design §Testing Strategy — Firestore adapter contract, regression guard.

All tests mock ``google.cloud.firestore.Client`` — zero live GCP dependency.
The approach bypasses __init__ and injects a mock _db client directly.

Collections tested:
  ``rockets``     — save_rocket, get_rocket, list_rockets
  ``simulations`` — save_simulation, list_simulations
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, call

import pytest

from icaro_api.services.db import FirestoreDb, RocketRecord, SimRecord


# ---------------------------------------------------------------------------
# Helpers & fixtures
# ---------------------------------------------------------------------------


_BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
_T1 = _BASE
_T2 = _BASE + timedelta(days=30)
_T3 = _BASE + timedelta(days=60)


def _make_rocket(rocket_id: str = "r1", dt: datetime | None = None) -> RocketRecord:
    return RocketRecord(
        rocket_id=rocket_id,
        name="TestRocket",
        created_at=dt or _T1,
        created_by="ci",
        export_prefix=f"exports/{rocket_id}/",
        manifest={"name": "TestRocket", "version": "1"},
        gcs_ref=f"exports/{rocket_id}/",
        ork_filename="test.ork",
        has_source_ork=False,
    )


def _make_sim(
    sim_id: str = "s1",
    rocket_id: str = "r1",
    dt: datetime | None = None,
    status: str = "done",
) -> SimRecord:
    return SimRecord(
        simulation_id=sim_id,
        rocket_id=rocket_id,
        scenario={"site": "launch_pad"},
        created_at=dt or _T1,
        created_by="ci",
        status=status,
        scalars={"apogee_m": 3000.0},
        warnings=[],
        result_prefix=f"results/{sim_id}/",
        plot_names=["trajectory_3d.png"],
        has_series=True,
        artifact_refs={"result_json": f"results/{sim_id}/result.json"},
    )


@pytest.fixture()
def mock_db_client():
    """Return a mock Firestore client."""
    return MagicMock()


@pytest.fixture()
def fs(mock_db_client):
    """Return a FirestoreDb instance with injected mock client (no GCP)."""
    db = FirestoreDb.__new__(FirestoreDb)
    db._db = mock_db_client
    return db


# ---------------------------------------------------------------------------
# save_rocket
# ---------------------------------------------------------------------------


class TestFirestoreDbSaveRocket:
    def test_writes_to_rockets_collection(self, fs, mock_db_client):
        """save_rocket must call .collection('rockets').document(rocket_id).set(...)."""
        rec = _make_rocket("r-save")
        fs.save_rocket(rec)

        mock_db_client.collection.assert_called_once_with("rockets")
        collection = mock_db_client.collection.return_value
        collection.document.assert_called_once_with("r-save")
        doc_ref = collection.document.return_value
        assert doc_ref.set.called

    def test_set_contains_expected_fields(self, fs, mock_db_client):
        """The dict passed to .set() must include name, created_at, manifest, gcs_ref."""
        rec = _make_rocket("r-fields")
        fs.save_rocket(rec)

        doc_ref = (
            mock_db_client.collection.return_value.document.return_value
        )
        set_kwargs = doc_ref.set.call_args[0][0]  # positional first arg

        assert set_kwargs["name"] == "TestRocket"
        assert set_kwargs["created_at"] == rec.created_at
        assert set_kwargs["manifest"] == {"name": "TestRocket", "version": "1"}
        assert set_kwargs["gcs_ref"] == "exports/r-fields/"

    def test_set_preserves_datetime_object(self, fs, mock_db_client):
        """created_at must remain a datetime object (Firestore serialises it natively)."""
        rec = _make_rocket("r-dt")
        fs.save_rocket(rec)

        doc_ref = mock_db_client.collection.return_value.document.return_value
        doc_data = doc_ref.set.call_args[0][0]

        assert isinstance(doc_data["created_at"], datetime)


# ---------------------------------------------------------------------------
# get_rocket
# ---------------------------------------------------------------------------


class TestFirestoreDbGetRocket:
    def test_returns_rocket_record_when_exists(self, fs, mock_db_client):
        """get_rocket returns a populated RocketRecord when the document exists."""
        rec = _make_rocket("r-get")

        snap = MagicMock()
        snap.exists = True
        snap.to_dict.return_value = {
            "name": rec.name,
            "created_at": rec.created_at,
            "created_by": rec.created_by,
            "export_prefix": rec.export_prefix,
            "manifest": rec.manifest,
            "gcs_ref": rec.gcs_ref,
            "ork_filename": rec.ork_filename,
            "has_source_ork": rec.has_source_ork,
        }
        (
            mock_db_client.collection.return_value
            .document.return_value
            .get.return_value
        ) = snap

        result = fs.get_rocket("r-get")

        assert result is not None
        assert result.rocket_id == "r-get"
        assert result.name == "TestRocket"

    def test_returns_none_when_not_found(self, fs, mock_db_client):
        """get_rocket returns None when the document does not exist."""
        snap = MagicMock()
        snap.exists = False
        (
            mock_db_client.collection.return_value
            .document.return_value
            .get.return_value
        ) = snap

        result = fs.get_rocket("r-missing")

        assert result is None

    def test_queries_correct_document_id(self, fs, mock_db_client):
        """get_rocket must call .document(rocket_id) with the exact id."""
        snap = MagicMock()
        snap.exists = False
        (
            mock_db_client.collection.return_value
            .document.return_value
            .get.return_value
        ) = snap

        fs.get_rocket("r-query-id")

        mock_db_client.collection.assert_called_with("rockets")
        mock_db_client.collection.return_value.document.assert_called_with(
            "r-query-id"
        )


# ---------------------------------------------------------------------------
# list_rockets
# ---------------------------------------------------------------------------


class TestFirestoreDbListRockets:
    def _make_snap(self, rocket_id: str, data: dict) -> MagicMock:
        snap = MagicMock()
        snap.id = rocket_id
        snap.to_dict.return_value = data
        return snap

    def test_queries_rockets_collection_with_order_desc(self, fs, mock_db_client):
        """list_rockets must query 'rockets' ordered by created_at DESCENDING."""
        # Chain: collection(...).order_by(...).limit(...).[start_after(...).]stream()
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.stream.return_value = []

        fs.list_rockets(limit=10)

        mock_db_client.collection.assert_called_with("rockets")
        q.order_by.assert_called_once()
        # Verify field name and direction string
        order_args = q.order_by.call_args
        assert order_args.args[0] == "created_at"
        direction_used = (
            order_args.args[1] if len(order_args.args) > 1
            else order_args.kwargs.get("direction")
        )
        assert direction_used == "DESCENDING"

    def test_applies_limit(self, fs, mock_db_client):
        """list_rockets must call .limit(n) with the requested limit."""
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.stream.return_value = []

        fs.list_rockets(limit=5)

        q.limit.assert_called_once_with(5)

    def test_applies_cursor_when_before_given(self, fs, mock_db_client):
        """list_rockets must call .start_after({'created_at': before}) when before is set."""
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.start_after.return_value = q
        q.stream.return_value = []

        fs.list_rockets(limit=20, before=_T2)

        q.start_after.assert_called_once_with({"created_at": _T2})

    def test_no_start_after_when_before_is_none(self, fs, mock_db_client):
        """list_rockets must NOT call start_after when before is None."""
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.stream.return_value = []

        fs.list_rockets(limit=20, before=None)

        q.start_after.assert_not_called()

    def test_returns_list_of_rocket_records(self, fs, mock_db_client):
        """list_rockets must deserialise snapshots into RocketRecord objects."""
        snap = self._make_snap(
            "r-listed",
            {
                "name": "Listed",
                "created_at": _T1,
                "created_by": "ci",
                "export_prefix": "exports/r-listed/",
                "manifest": {},
                "gcs_ref": "exports/r-listed/",
                "ork_filename": None,
                "has_source_ork": False,
            },
        )
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.stream.return_value = [snap]

        result = fs.list_rockets()

        assert len(result) == 1
        assert result[0].rocket_id == "r-listed"
        assert result[0].name == "Listed"


# ---------------------------------------------------------------------------
# save_simulation
# ---------------------------------------------------------------------------


class TestFirestoreDbSaveSimulation:
    def test_writes_to_simulations_collection(self, fs, mock_db_client):
        """save_simulation must call .collection('simulations').document(sim_id).set(...)."""
        rec = _make_sim("s-save")
        fs.save_simulation(rec)

        mock_db_client.collection.assert_called_once_with("simulations")
        collection = mock_db_client.collection.return_value
        collection.document.assert_called_once_with("s-save")
        doc_ref = collection.document.return_value
        assert doc_ref.set.called

    def test_set_contains_expected_fields(self, fs, mock_db_client):
        """The dict passed to .set() must include rocket_id, status, scalars, artifact_refs."""
        rec = _make_sim("s-fields")
        fs.save_simulation(rec)

        doc_ref = (
            mock_db_client.collection.return_value.document.return_value
        )
        set_kwargs = doc_ref.set.call_args[0][0]

        assert set_kwargs["rocket_id"] == "r1"
        assert set_kwargs["status"] == "done"
        assert set_kwargs["scalars"] == {"apogee_m": 3000.0}
        assert "result_json" in set_kwargs["artifact_refs"]

    def test_set_preserves_datetime_object(self, fs, mock_db_client):
        """created_at must remain a datetime object for Firestore serialisation."""
        rec = _make_sim("s-dt")
        fs.save_simulation(rec)

        doc_ref = mock_db_client.collection.return_value.document.return_value
        doc_data = doc_ref.set.call_args[0][0]

        assert isinstance(doc_data["created_at"], datetime)


# ---------------------------------------------------------------------------
# list_simulations
# ---------------------------------------------------------------------------


class TestFirestoreDbListSimulations:
    def _make_snap(self, sim_id: str, data: dict) -> MagicMock:
        snap = MagicMock()
        snap.id = sim_id
        snap.to_dict.return_value = data
        return snap

    def test_queries_simulations_collection_ordered_desc(self, fs, mock_db_client):
        """list_simulations queries 'simulations' with order_by created_at DESCENDING."""
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.stream.return_value = []

        fs.list_simulations(limit=10)

        mock_db_client.collection.assert_called_with("simulations")
        q.order_by.assert_called_once()
        order_args = q.order_by.call_args
        assert order_args.args[0] == "created_at"
        direction_used = (
            order_args.args[1] if len(order_args.args) > 1
            else order_args.kwargs.get("direction")
        )
        assert direction_used == "DESCENDING"

    def test_applies_limit(self, fs, mock_db_client):
        """list_simulations must call .limit(n)."""
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.stream.return_value = []

        fs.list_simulations(limit=7)

        q.limit.assert_called_once_with(7)

    def test_applies_cursor_when_before_given(self, fs, mock_db_client):
        """list_simulations must call .start_after({'created_at': before})."""
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.start_after.return_value = q
        q.stream.return_value = []

        fs.list_simulations(limit=20, before=_T2)

        q.start_after.assert_called_once_with({"created_at": _T2})

    def test_no_start_after_when_before_none(self, fs, mock_db_client):
        """list_simulations must NOT call start_after when before is None."""
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.stream.return_value = []

        fs.list_simulations(limit=20, before=None)

        q.start_after.assert_not_called()

    def test_returns_list_of_sim_records(self, fs, mock_db_client):
        """list_simulations deserialises snapshots into SimRecord objects."""
        snap = self._make_snap(
            "s-listed",
            {
                "rocket_id": "r1",
                "scenario": {"site": "field"},
                "created_at": _T1,
                "created_by": "ci",
                "status": "done",
                "scalars": {"apogee_m": 2500.0},
                "warnings": [],
                "result_prefix": "results/s-listed/",
                "plot_names": [],
                "has_series": False,
                "artifact_refs": {},
            },
        )
        q = mock_db_client.collection.return_value
        q.order_by.return_value = q
        q.limit.return_value = q
        q.stream.return_value = [snap]

        result = fs.list_simulations()

        assert len(result) == 1
        assert result[0].simulation_id == "s-listed"
        assert result[0].scalars == {"apogee_m": 2500.0}
