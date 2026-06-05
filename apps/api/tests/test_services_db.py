"""Contract tests for InMemoryDb adapter — T-25.

TDD: T-25 (RED) written first; T-26 (GREEN) fixes any ordering/pagination bugs.
Req: Design §Testing Strategy — adapter contract, regression guard.

Tests use InMemoryDb only (no GCP).  These are the unit-level assertions that
FirestoreDb must also satisfy (verified via T-27-equivalent contract for DB).
"""

from __future__ import annotations

from datetime import datetime, timezone, timedelta

import pytest

from icaro_api.services.db import InMemoryDb, RocketRecord, SimRecord


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _rocket(
    rocket_id: str,
    name: str = "TestRocket",
    dt: datetime | None = None,
) -> RocketRecord:
    return RocketRecord(
        rocket_id=rocket_id,
        name=name,
        created_at=dt or datetime(2026, 1, 1, tzinfo=timezone.utc),
        created_by="test",
        export_prefix=f"exports/{rocket_id}/",
    )


def _sim(
    sim_id: str,
    rocket_id: str = "r1",
    dt: datetime | None = None,
    status: str = "done",
) -> SimRecord:
    return SimRecord(
        simulation_id=sim_id,
        rocket_id=rocket_id,
        scenario={},
        created_at=dt or datetime(2026, 1, 1, tzinfo=timezone.utc),
        created_by="test",
        status=status,
        scalars={"apogee_m": 3000.0},
    )


_BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
_T1 = _BASE
_T2 = _BASE + timedelta(days=30)
_T3 = _BASE + timedelta(days=60)


# ---------------------------------------------------------------------------
# Rocket contracts
# ---------------------------------------------------------------------------


class TestInMemoryDbRocketContract:
    def test_save_and_get_rocket(self):
        """save_rocket + get_rocket round-trip."""
        db = InMemoryDb()
        r = _rocket("r-roundtrip", "Alpha")
        db.save_rocket(r)
        got = db.get_rocket("r-roundtrip")
        assert got is not None
        assert got.rocket_id == "r-roundtrip"
        assert got.name == "Alpha"

    def test_get_rocket_returns_none_for_unknown(self):
        """get_rocket returns None for an unknown id."""
        db = InMemoryDb()
        assert db.get_rocket("does-not-exist") is None

    def test_list_rockets_reverse_chronological(self):
        """list_rockets returns newest-first."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r1", dt=_T1))
        db.save_rocket(_rocket("r2", dt=_T2))
        db.save_rocket(_rocket("r3", dt=_T3))
        records = db.list_rockets()
        ids = [r.rocket_id for r in records]
        assert ids == ["r3", "r2", "r1"], f"Expected [r3, r2, r1], got {ids}"

    def test_list_rockets_default_limit_20(self):
        """Default limit is 20."""
        db = InMemoryDb()
        for i in range(25):
            dt = _BASE + timedelta(hours=i)
            db.save_rocket(_rocket(f"r-lim-{i}", dt=dt))
        records = db.list_rockets()
        assert len(records) == 20

    def test_list_rockets_custom_limit(self):
        """Custom limit is respected."""
        db = InMemoryDb()
        for i in range(10):
            dt = _BASE + timedelta(hours=i)
            db.save_rocket(_rocket(f"r-cust-{i}", dt=dt))
        records = db.list_rockets(limit=5)
        assert len(records) == 5

    def test_list_rockets_cursor_before(self):
        """before= cursor excludes records at or after the cursor."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r-old", dt=_T1))
        db.save_rocket(_rocket("r-mid", dt=_T2))
        db.save_rocket(_rocket("r-new", dt=_T3))
        # before=T3 must exclude r-new
        records = db.list_rockets(before=_T3)
        ids = [r.rocket_id for r in records]
        assert "r-new" not in ids, f"r-new should be excluded by cursor: {ids}"
        assert "r-mid" in ids
        assert "r-old" in ids

    def test_list_rockets_cursor_returns_correct_window(self):
        """Cursor window is correct (page 2 after T2)."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r-a", dt=_T1))
        db.save_rocket(_rocket("r-b", dt=_T2))
        db.save_rocket(_rocket("r-c", dt=_T3))
        # before=T2 — only r-a (T1) qualifies
        records = db.list_rockets(before=_T2)
        ids = [r.rocket_id for r in records]
        assert ids == ["r-a"], f"Expected [r-a], got {ids}"

    def test_save_rocket_upserts_by_id(self):
        """Second save with same rocket_id updates the record."""
        db = InMemoryDb()
        db.save_rocket(_rocket("r-upsert", "OldName"))
        db.save_rocket(_rocket("r-upsert", "NewName"))
        got = db.get_rocket("r-upsert")
        assert got is not None
        assert got.name == "NewName"

    def test_list_rockets_empty(self):
        """Empty db → empty list."""
        db = InMemoryDb()
        assert db.list_rockets() == []


# ---------------------------------------------------------------------------
# Simulation contracts
# ---------------------------------------------------------------------------


class TestInMemoryDbSimulationContract:
    def test_save_and_list_simulation(self):
        """save_simulation + list_simulations round-trip."""
        db = InMemoryDb()
        db.save_simulation(_sim("s-rt"))
        records = db.list_simulations()
        assert len(records) == 1
        assert records[0].simulation_id == "s-rt"

    def test_list_simulations_reverse_chronological(self):
        """list_simulations returns newest-first."""
        db = InMemoryDb()
        db.save_simulation(_sim("s1", dt=_T1))
        db.save_simulation(_sim("s2", dt=_T2))
        db.save_simulation(_sim("s3", dt=_T3))
        records = db.list_simulations()
        ids = [r.simulation_id for r in records]
        assert ids == ["s3", "s2", "s1"], f"Expected [s3, s2, s1], got {ids}"

    def test_list_simulations_default_limit_20(self):
        """Default limit is 20."""
        db = InMemoryDb()
        for i in range(25):
            dt = _BASE + timedelta(hours=i)
            db.save_simulation(_sim(f"s-lim-{i}", dt=dt))
        records = db.list_simulations()
        assert len(records) == 20

    def test_list_simulations_cursor_before(self):
        """before= cursor excludes records at or after the cursor."""
        db = InMemoryDb()
        db.save_simulation(_sim("s-old", dt=_T1))
        db.save_simulation(_sim("s-mid", dt=_T2))
        db.save_simulation(_sim("s-new", dt=_T3))
        records = db.list_simulations(before=_T3)
        ids = [r.simulation_id for r in records]
        assert "s-new" not in ids, f"s-new should be excluded by cursor: {ids}"
        assert "s-mid" in ids
        assert "s-old" in ids

    def test_list_simulations_cursor_returns_correct_window(self):
        """Cursor window returns correct page."""
        db = InMemoryDb()
        db.save_simulation(_sim("s-a", dt=_T1))
        db.save_simulation(_sim("s-b", dt=_T2))
        db.save_simulation(_sim("s-c", dt=_T3))
        records = db.list_simulations(before=_T2)
        ids = [r.simulation_id for r in records]
        assert ids == ["s-a"], f"Expected [s-a], got {ids}"

    def test_save_simulation_upserts_by_id(self):
        """Second save with same simulation_id updates the record."""
        db = InMemoryDb()
        db.save_simulation(_sim("s-upsert", status="done"))
        s2 = _sim("s-upsert", status="error")
        db.save_simulation(s2)
        records = db.list_simulations()
        assert len(records) == 1
        assert records[0].status == "error"

    def test_list_simulations_empty(self):
        """Empty db → empty list."""
        db = InMemoryDb()
        assert db.list_simulations() == []
