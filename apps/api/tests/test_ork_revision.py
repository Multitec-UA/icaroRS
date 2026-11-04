"""``ork_revision``: which import of the same ``.ork`` file name an export is.

Within one rocket, the exports that share an ``ork_filename`` are numbered
1..n by import date (``created_at``, oldest first). A file imported only once
has no revision (``null``): there is nothing to tell apart. Every endpoint that
describes an export carries it: the rocket detail, the export detail, the run
summaries and the convert response.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from icaro_api.services.db import InMemoryDb
from tests.test_convert_router import _client_with_db, _ok_export, _ork_file_content
from tests.test_history import _sim
from tests.test_rockets import _ORG, _OTHER_ORG, _auth, _export, _make_client, _rocket

_T0 = datetime(2026, 6, 1, tzinfo=timezone.utc)


def _at(days: int) -> datetime:
    return _T0 + timedelta(days=days)


def _mt1_db() -> InMemoryDb:
    """One rocket with v1.5.1 imported three times, v1.6.0 twice and v1.6.1 once."""
    db = InMemoryDb()
    db.save_rocket(_rocket("mt1", "MT1 Lucentum", _T0), org_id=_ORG)
    db.save_rocket(_rocket("other", "Other", _T0), org_id=_ORG)
    for export_id, filename, day in [
        ("e-151-a", "MT1-v1.5.1.ork", 0),
        ("e-160-a", "MT1-v1.6.0.ork", 1),
        ("e-151-b", "MT1-v1.5.1.ork", 2),
        ("e-161", "MT1-v1.6.1.ork", 3),
        ("e-151-c", "MT1-v1.5.1.ork", 4),
        ("e-160-b", "MT1-v1.6.0.ork", 5),
    ]:
        db.save_export(_export(export_id, "mt1", _at(day), ork_filename=filename), org_id=_ORG)
    # Same file name in another rocket: numbered on its own, never with mt1's.
    db.save_export(_export("e-other", "other", _at(6), ork_filename="MT1-v1.5.1.ork"), org_id=_ORG)
    return db


class TestRocketDetail:
    def test_duplicates_are_numbered_by_import_date_and_unique_files_have_none(self):
        resp = _make_client(_mt1_db()).get("/api/rockets/mt1", headers=_auth())
        assert resp.status_code == 200
        revisions = {e["export_id"]: e["ork_revision"] for e in resp.json()["exports"]}
        assert revisions == {
            "e-151-a": 1,
            "e-151-b": 2,
            "e-151-c": 3,
            "e-160-a": 1,
            "e-160-b": 2,
            "e-161": None,
        }

    def test_the_same_file_name_in_another_rocket_counts_apart(self):
        resp = _make_client(_mt1_db()).get("/api/rockets/other", headers=_auth())
        assert [e["ork_revision"] for e in resp.json()["exports"]] == [None]

    def test_another_orgs_export_with_the_same_name_never_counts(self):
        db = _mt1_db()
        db.save_export(
            _export("e-theirs", "mt1", _at(10), ork_filename="MT1-v1.6.1.ork", org_id=_OTHER_ORG),
            org_id=_OTHER_ORG,
        )
        resp = _make_client(db).get("/api/rockets/mt1", headers=_auth())
        assert {e["export_id"]: e["ork_revision"] for e in resp.json()["exports"]}["e-161"] is None

    def test_an_export_without_a_file_name_has_none(self):
        db = _mt1_db()
        db.save_export(_export("e-nameless", "mt1", _at(7), ork_filename=None), org_id=_ORG)
        db.save_export(_export("e-nameless-2", "mt1", _at(8), ork_filename=None), org_id=_ORG)
        resp = _make_client(db).get("/api/rockets/mt1", headers=_auth())
        revisions = {e["export_id"]: e["ork_revision"] for e in resp.json()["exports"]}
        assert revisions["e-nameless"] is None and revisions["e-nameless-2"] is None


class TestExportDetail:
    def test_carries_its_revision(self):
        client = _make_client(_mt1_db())
        assert client.get("/api/exports/e-151-b", headers=_auth()).json()["ork_revision"] == 2
        assert client.get("/api/exports/e-161", headers=_auth()).json()["ork_revision"] is None


class TestRunSummaries:
    def test_list_and_detail_carry_the_revision_of_the_simulated_file(self):
        db = _mt1_db()
        db.save_simulation(_sim("s-1", "mt1", _at(20), export_id="e-160-b"), org_id=_ORG)
        db.save_simulation(_sim("s-2", "mt1", _at(21), export_id="e-161"), org_id=_ORG)
        db.save_simulation(_sim("s-3", "mt1", _at(22), export_id=""), org_id=_ORG)
        client = _make_client(db)

        rows = {r["simulation_id"]: r["ork_revision"] for r in client.get("/api/history", headers=_auth()).json()}
        assert rows == {"s-1": 2, "s-2": None, "s-3": None}
        assert client.get("/api/history/s-1", headers=_auth()).json()["ork_revision"] == 2


class TestConvert:
    def _convert(self, client, tmp_path, rocket_id: str, filename: str = "icarus.ork"):
        with patch("icaro_api.routers.convert.run_convert", return_value=_ok_export(tmp_path)):
            return client.post(
                "/api/convert",
                files={"file": (filename, io.BytesIO(_ork_file_content()), "application/octet-stream")},
                data={"rocket_id": rocket_id},
                headers=_auth(),
            )

    def test_reimporting_a_file_into_its_rocket_returns_the_next_revision(self, tmp_path):
        client, _db = _client_with_db()
        first = self._convert(client, tmp_path, "rk-existing")
        assert first.status_code == 200 and first.json()["ork_revision"] is None
        second = self._convert(client, tmp_path, "rk-existing")
        assert second.json()["ork_revision"] == 2

    def test_a_new_rocket_has_no_revision(self, tmp_path):
        client, _db = _client_with_db()
        with patch("icaro_api.routers.convert.run_convert", return_value=_ok_export(tmp_path)):
            resp = client.post(
                "/api/convert",
                files={"file": ("icarus.ork", io.BytesIO(_ork_file_content()), "application/octet-stream")},
                headers=_auth(),
            )
        assert resp.json()["ork_revision"] is None
