"""Contract tests for the Rocket/Export split in ``InMemoryDb`` (S1).

A *rocket* groups the ``.ork`` files a team uploads; an *export* is one
converted ``.ork`` (today's convert ``run_id`` / ``export_id``).  These tests
pin the new ``RocketRecord`` shape, the ``ExportRecord`` contract and the
``rocket_id`` filters on ``list_exports`` / ``list_simulations``.
"""

from __future__ import annotations

from dataclasses import fields
from datetime import datetime, timedelta, timezone

import pytest

from icaro_api.services.db import ExportRecord, InMemoryDb, RocketRecord, SimRecord

_ORG = "org-test"
_OTHER_ORG = "org-other"
_BASE = datetime(2026, 1, 1, tzinfo=timezone.utc)
_T1 = _BASE
_T2 = _BASE + timedelta(days=30)
_T3 = _BASE + timedelta(days=60)


def _rocket(rocket_id: str, name: str = "Icarus", dt: datetime | None = None, org_id: str = _ORG) -> RocketRecord:
    return RocketRecord(
        rocket_id=rocket_id,
        name=name,
        created_at=dt or _T1,
        created_by="test",
        org_id=org_id,
    )


def _export(
    export_id: str,
    rocket_id: str = "rk1",
    name: str = "Icarus",
    dt: datetime | None = None,
    org_id: str = _ORG,
    ork_filename: str | None = "icarus.ork",
) -> ExportRecord:
    return ExportRecord(
        export_id=export_id,
        rocket_id=rocket_id,
        name=name,
        created_at=dt or _T1,
        created_by="test",
        org_id=org_id,
        export_prefix=f"orgs/{org_id}/exports/{export_id}/",
        manifest={"name": name},
        gcs_ref=f"orgs/{org_id}/exports/{export_id}/",
        ork_filename=ork_filename,
        has_source_ork=True,
    )


def _sim(sim_id: str, export_id: str = "e1", rocket_id: str = "rk1", dt: datetime | None = None, org_id: str = _ORG) -> SimRecord:
    return SimRecord(
        simulation_id=sim_id,
        rocket_id=rocket_id,
        export_id=export_id,
        scenario={},
        created_at=dt or _T1,
        created_by="test",
        org_id=org_id,
        status="done",
    )


class TestRocketRecordShape:
    def test_rocket_record_has_no_export_fields(self):
        """A rocket is a group, not a file: no export_prefix/manifest/gcs_ref/ork_filename."""
        names = {f.name for f in fields(RocketRecord)}
        assert names == {"rocket_id", "name", "created_at", "created_by", "org_id"}

    def test_export_record_fields(self):
        names = {f.name for f in fields(ExportRecord)}
        assert names == {
            "export_id", "rocket_id", "name", "created_at", "created_by", "org_id",
            "export_prefix", "manifest", "gcs_ref", "ork_filename", "has_source_ork",
        }

    def test_sim_record_has_export_id(self):
        sim = _sim("s1", export_id="e-x", rocket_id="rk-x")
        assert sim.export_id == "e-x"
        assert sim.rocket_id == "rk-x"


class TestInMemoryDbExportContract:
    def test_save_and_get_export(self):
        db = InMemoryDb()
        db.save_export(_export("e-roundtrip", rocket_id="rk1", name="Alpha"), org_id=_ORG)
        got = db.get_export("e-roundtrip", org_id=_ORG)
        assert got is not None
        assert got.export_id == "e-roundtrip"
        assert got.rocket_id == "rk1"
        assert got.name == "Alpha"
        assert got.manifest == {"name": "Alpha"}

    def test_get_export_returns_none_for_unknown(self):
        assert InMemoryDb().get_export("nope", org_id=_ORG) is None

    def test_get_export_returns_none_for_another_org(self):
        db = InMemoryDb()
        db.save_export(_export("e-owned"), org_id=_ORG)
        assert db.get_export("e-owned", org_id=_OTHER_ORG) is None

    def test_save_export_rejects_mismatched_org_id(self):
        with pytest.raises(ValueError):
            InMemoryDb().save_export(_export("e-mismatch", org_id=_ORG), org_id=_OTHER_ORG)

    def test_save_export_upserts_by_id(self):
        db = InMemoryDb()
        db.save_export(_export("e-up", name="Old"), org_id=_ORG)
        db.save_export(_export("e-up", name="New"), org_id=_ORG)
        assert db.get_export("e-up", org_id=_ORG).name == "New"

    def test_list_exports_reverse_chronological(self):
        db = InMemoryDb()
        db.save_export(_export("e1", dt=_T1), org_id=_ORG)
        db.save_export(_export("e2", dt=_T2), org_id=_ORG)
        db.save_export(_export("e3", dt=_T3), org_id=_ORG)
        assert [e.export_id for e in db.list_exports(org_id=_ORG)] == ["e3", "e2", "e1"]

    def test_list_exports_only_returns_caller_org(self):
        db = InMemoryDb()
        db.save_export(_export("e-mine", dt=_T1), org_id=_ORG)
        db.save_export(_export("e-theirs", dt=_T2, org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        assert [e.export_id for e in db.list_exports(org_id=_ORG)] == ["e-mine"]

    def test_list_exports_filters_by_rocket_id(self):
        db = InMemoryDb()
        db.save_export(_export("e-a", rocket_id="rk-a", dt=_T1), org_id=_ORG)
        db.save_export(_export("e-b", rocket_id="rk-b", dt=_T2), org_id=_ORG)
        db.save_export(_export("e-a2", rocket_id="rk-a", dt=_T3), org_id=_ORG)
        ids = [e.export_id for e in db.list_exports(org_id=_ORG, rocket_id="rk-a")]
        assert ids == ["e-a2", "e-a"]

    def test_list_exports_rocket_filter_respects_org(self):
        db = InMemoryDb()
        db.save_export(_export("e-theirs", rocket_id="rk-shared", org_id=_OTHER_ORG), org_id=_OTHER_ORG)
        assert db.list_exports(org_id=_ORG, rocket_id="rk-shared") == []

    def test_list_exports_limit_and_cursor(self):
        db = InMemoryDb()
        for i in range(25):
            db.save_export(_export(f"e-{i}", dt=_BASE + timedelta(hours=i)), org_id=_ORG)
        assert len(db.list_exports(org_id=_ORG)) == 20
        assert len(db.list_exports(org_id=_ORG, limit=5)) == 5
        before = _BASE + timedelta(hours=3)
        ids = [e.export_id for e in db.list_exports(org_id=_ORG, before=before)]
        assert ids == ["e-2", "e-1", "e-0"]

    def test_list_exports_empty(self):
        assert InMemoryDb().list_exports(org_id=_ORG) == []


class TestInMemoryDbSimulationsByRocket:
    def test_list_simulations_filters_by_rocket_id(self):
        db = InMemoryDb()
        db.save_simulation(_sim("s1", export_id="e1", rocket_id="rk-a", dt=_T1), org_id=_ORG)
        db.save_simulation(_sim("s2", export_id="e2", rocket_id="rk-b", dt=_T2), org_id=_ORG)
        db.save_simulation(_sim("s3", export_id="e3", rocket_id="rk-a", dt=_T3), org_id=_ORG)
        ids = [s.simulation_id for s in db.list_simulations(org_id=_ORG, rocket_id="rk-a")]
        assert ids == ["s3", "s1"]

    def test_list_simulations_without_filter_returns_all(self):
        db = InMemoryDb()
        db.save_simulation(_sim("s1", rocket_id="rk-a", dt=_T1), org_id=_ORG)
        db.save_simulation(_sim("s2", rocket_id="rk-b", dt=_T2), org_id=_ORG)
        assert len(db.list_simulations(org_id=_ORG)) == 2

    def test_simulation_round_trips_export_id(self):
        db = InMemoryDb()
        db.save_simulation(_sim("s-rt", export_id="e-rt", rocket_id="rk-rt"), org_id=_ORG)
        got = db.get_simulation("s-rt", org_id=_ORG)
        assert got is not None and got.export_id == "e-rt" and got.rocket_id == "rk-rt"
