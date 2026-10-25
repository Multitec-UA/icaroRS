"""Firestore-emulator integration tests — T-46/T-47.

Guards against the PR #28 class of bug (Firestore rejecting nested arrays in
the ``manifest`` field) and validates real round-trip behaviour of
``FirestoreDb`` against the local Firestore emulator.

Requires:
- ``FIRESTORE_EMULATOR_HOST`` env var set (e.g. ``127.0.0.1:8085``)
- The Firestore emulator running at that host
- The ``[gcp]`` extra installed (``uv sync --extra gcp``)

Run:
    FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 \\
    uv run --no-sync pytest -m integration tests/test_firestore_emulator.py -v

GitHub issue: #29
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

from icaro_api.services.db import ExportRecord, FirestoreDb, RocketRecord, SimRecord


# ---------------------------------------------------------------------------
# Module-level marker — collected only when -m integration is passed
# ---------------------------------------------------------------------------

pytestmark = pytest.mark.integration


# ---------------------------------------------------------------------------
# Module-level emulator guard
# ---------------------------------------------------------------------------

_EMULATOR_HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "")

if not _EMULATOR_HOST:
    pytest.skip(
        "FIRESTORE_EMULATOR_HOST is not set — emulator tests skipped",
        allow_module_level=True,
    )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_PROJECT = "icaro-emulator-test"
_ORG = "test-org"
_BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


@pytest.fixture(scope="module")
def db() -> FirestoreDb:
    """Real FirestoreDb instance pointing at the local emulator.

    The google-cloud-firestore client auto-connects to the emulator when
    ``FIRESTORE_EMULATOR_HOST`` is set — no code change in the adapter.
    """
    return FirestoreDb(project=_PROJECT, database="(default)")


@pytest.fixture(autouse=True)
def _clear_collections(db: FirestoreDb) -> None:
    """Delete all documents in ``rockets``, ``exports`` and ``simulations`` before each test.

    This gives each test a clean slate without relying on unique IDs that
    accumulate state across sessions, and avoids fragile time-based coupling.
    """
    for col_name in ("rockets", "exports", "simulations"):
        col = db._db.collection(col_name)
        docs = col.stream()
        for doc in docs:
            doc.reference.delete()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _rocket(
    rocket_id: str = "r-test",
    dt: datetime | None = None,
    org_id: str = _ORG,
) -> RocketRecord:
    return RocketRecord(
        rocket_id=rocket_id,
        name="TestRocket",
        created_at=dt or _BASE,
        created_by="ci",
        org_id=org_id,
    )


def _export(
    export_id: str = "e-test",
    rocket_id: str = "r-test",
    dt: datetime | None = None,
    manifest: dict | None = None,
    org_id: str = _ORG,
) -> ExportRecord:
    return ExportRecord(
        export_id=export_id,
        rocket_id=rocket_id,
        name="TestRocket",
        created_at=dt or _BASE,
        created_by="ci",
        org_id=org_id,
        export_prefix=f"exports/{export_id}/",
        manifest=manifest if manifest is not None else {"name": "TestRocket"},
        gcs_ref=f"exports/{export_id}/",
        ork_filename="test.ork",
        has_source_ork=False,
    )


def _sim(
    sim_id: str = "s-test",
    rocket_id: str = "r-test",
    dt: datetime | None = None,
    scenario: dict | None = None,
    org_id: str = _ORG,
) -> SimRecord:
    return SimRecord(
        simulation_id=sim_id,
        rocket_id=rocket_id,
        scenario=scenario if scenario is not None else {"site": "launch_pad", "wind_speed": 5.0},
        created_at=dt or _BASE,
        created_by="ci",
        org_id=org_id,
        status="done",
        scalars={"apogee_m": 3000.0, "max_speed_mps": 340.0},
        warnings=[],
        result_prefix=f"results/{sim_id}/",
        plot_names=["trajectory_3d.png"],
        has_series=True,
        artifact_refs={"result_json": f"results/{sim_id}/result.json"},
    )


# ---------------------------------------------------------------------------
# Test: PR #28 regression — nested arrays in manifest must NOT reach Firestore
# ---------------------------------------------------------------------------


class TestPR28NestedArrayRegression:
    """Guard against Firestore 400 InvalidArgument: invalid nested entity.

    Before the PR #28 fix, ``save_export`` would pass the full ``manifest``
    dict to Firestore.  Manifests with freeform fins contain arrays nested
    directly inside arrays (``shape_points: [[x, y], ...]``), which Firestore
    Native Mode rejects.  The fix pops ``manifest`` before writing — this test
    confirms that contract holds against a REAL emulator.
    """

    def test_save_export_with_nested_array_manifest_does_not_raise(
        self, db: FirestoreDb
    ) -> None:
        """save_export with freeform-fin nested arrays must not raise.

        The adapter must silently drop the manifest before writing.  If it
        reaches Firestore unmodified, the emulator returns 400 — proving the
        regression guard is non-vacuous (the emulator enforces the same rule
        as production Firestore Native).
        """
        manifest_with_nested_arrays = {
            "name": "FreeformRocket",
            "freeform_fins": [
                {
                    "name": "delta-fin",
                    "shape_points": [
                        [0.0, 0.0],
                        [0.1, 0.05],
                        [0.2, 0.03],
                        [0.15, 0.0],
                    ],
                }
            ],
        }
        rec = _export("e-pr28", manifest=manifest_with_nested_arrays)

        # Must not raise 400 InvalidArgument
        db.save_export(rec, org_id=_ORG)

    def test_raw_firestore_doc_has_no_manifest_field(
        self, db: FirestoreDb
    ) -> None:
        """The raw Firestore document must contain NO ``manifest`` key.

        The manifest is stored in object storage, not Firestore.  This test
        reads back the raw doc via the underlying client to confirm the field
        was stripped — not just that the adapter suppressed the error.
        """
        rec = _export(
            "e-pr28-raw",
            manifest={
                "name": "FreeformRocket",
                "freeform_fins": [
                    {"shape_points": [[0.0, 0.0], [0.1, 0.2]]}
                ],
            },
        )
        db.save_export(rec, org_id=_ORG)

        snap = db._db.collection("exports").document("e-pr28-raw").get()
        assert snap.exists, "Document was not written to Firestore"

        raw = snap.to_dict()
        assert "manifest" not in raw, (
            f"``manifest`` must be stripped before writing to Firestore; "
            f"got keys: {list(raw.keys())}"
        )

    def test_raw_firestore_doc_has_metadata_fields(
        self, db: FirestoreDb
    ) -> None:
        """Even without the manifest, metadata fields must be present.

        Stripping the manifest must not silently drop other fields like
        ``name``, ``export_prefix``, ``gcs_ref``, or ``created_by``.
        """
        rec = _export(
            "e-pr28-meta",
            manifest={"name": "FreeformRocket", "freeform_fins": [{"shape_points": [[0.0, 0.0]]}]},
        )
        db.save_export(rec, org_id=_ORG)

        snap = db._db.collection("exports").document("e-pr28-meta").get()
        raw = snap.to_dict()

        assert raw["name"] == "TestRocket"
        assert raw["export_prefix"] == "exports/e-pr28-meta/"
        assert raw["gcs_ref"] == "exports/e-pr28-meta/"
        assert raw["created_by"] == "ci"
        assert raw["has_source_ork"] is False


# ---------------------------------------------------------------------------
# Test: get_rocket round-trip and None for missing
# ---------------------------------------------------------------------------


class TestGetRocket:
    def test_get_rocket_returns_saved_record(self, db: FirestoreDb) -> None:
        """save_rocket then get_rocket returns a matching RocketRecord."""
        rec = _rocket("r-get")
        db.save_rocket(rec, org_id=_ORG)

        got = db.get_rocket("r-get", org_id=_ORG)

        assert got is not None
        assert got.rocket_id == "r-get"
        assert got.name == "TestRocket"
        assert got.created_by == "ci"

    def test_get_rocket_returns_none_for_missing_id(
        self, db: FirestoreDb
    ) -> None:
        """get_rocket returns None when no document exists for the given id."""
        result = db.get_rocket("does-not-exist-xyz", org_id=_ORG)
        assert result is None

    def test_get_export_manifest_defaults_to_empty_dict(
        self, db: FirestoreDb
    ) -> None:
        """Since the manifest is not stored, get_export must return ``{}`` for it."""
        rec = _export("e-get-manifest", manifest={"name": "Rocket", "version": "1"})
        db.save_export(rec, org_id=_ORG)

        got = db.get_export("e-get-manifest", org_id=_ORG)
        assert got is not None
        assert got.rocket_id == "r-test"
        assert got.export_prefix == "exports/e-get-manifest/"
        assert got.ork_filename == "test.ork"
        assert got.manifest == {}, (
            "manifest must be empty dict after round-trip (not stored in Firestore)"
        )


class TestListExports:
    def test_list_exports_by_rocket_newest_first(self, db: FirestoreDb) -> None:
        """list_exports(rocket_id=...) returns only that rocket's files, newest first."""
        db.save_export(_export("e-a", rocket_id="rk-a", dt=_BASE), org_id=_ORG)
        db.save_export(_export("e-b", rocket_id="rk-b", dt=_BASE + timedelta(hours=1)), org_id=_ORG)
        db.save_export(_export("e-a2", rocket_id="rk-a", dt=_BASE + timedelta(hours=2)), org_id=_ORG)

        ids = [e.export_id for e in db.list_exports(org_id=_ORG, rocket_id="rk-a", limit=10)]
        assert ids == ["e-a2", "e-a"]
        assert len(db.list_exports(org_id=_ORG, limit=10)) == 3

    def test_list_simulations_by_rocket(self, db: FirestoreDb) -> None:
        """list_simulations(rocket_id=...) filters on the denormalised rocket_id."""
        db.save_simulation(_sim("s-a", rocket_id="rk-a", dt=_BASE), org_id=_ORG)
        db.save_simulation(_sim("s-b", rocket_id="rk-b", dt=_BASE + timedelta(hours=1)), org_id=_ORG)

        ids = [s.simulation_id for s in db.list_simulations(org_id=_ORG, rocket_id="rk-a", limit=10)]
        assert ids == ["s-a"]


# ---------------------------------------------------------------------------
# Test: list_rockets — reverse-chronological + cursor pagination
# ---------------------------------------------------------------------------


class TestListRockets:
    def test_list_rockets_reverse_chronological(self, db: FirestoreDb) -> None:
        """list_rockets returns records newest-first."""
        t1 = _BASE
        t2 = _BASE + timedelta(hours=1)
        t3 = _BASE + timedelta(hours=2)

        db.save_rocket(_rocket("r-list-a", dt=t1), org_id=_ORG)
        db.save_rocket(_rocket("r-list-b", dt=t2), org_id=_ORG)
        db.save_rocket(_rocket("r-list-c", dt=t3), org_id=_ORG)

        records = db.list_rockets(org_id=_ORG, limit=10)
        ids = [r.rocket_id for r in records]

        assert ids == ["r-list-c", "r-list-b", "r-list-a"], (
            f"Expected newest-first order, got: {ids}"
        )

    def test_list_rockets_limit_respected(self, db: FirestoreDb) -> None:
        """list_rockets respects the ``limit`` parameter."""
        for i in range(5):
            dt = _BASE + timedelta(hours=i)
            db.save_rocket(_rocket(f"r-lim-{i}", dt=dt), org_id=_ORG)

        records = db.list_rockets(org_id=_ORG, limit=3)
        assert len(records) == 3

    def test_list_rockets_cursor_excludes_records_at_or_after(
        self, db: FirestoreDb
    ) -> None:
        """``before`` cursor excludes the record at the cursor timestamp."""
        t1 = _BASE
        t2 = _BASE + timedelta(hours=1)
        t3 = _BASE + timedelta(hours=2)

        db.save_rocket(_rocket("r-cur-a", dt=t1), org_id=_ORG)
        db.save_rocket(_rocket("r-cur-b", dt=t2), org_id=_ORG)
        db.save_rocket(_rocket("r-cur-c", dt=t3), org_id=_ORG)

        # before=t3 should exclude r-cur-c
        records = db.list_rockets(org_id=_ORG, limit=10, before=t3)
        ids = [r.rocket_id for r in records]

        assert "r-cur-c" not in ids, f"Cursor should exclude the newest; got: {ids}"
        assert "r-cur-b" in ids
        assert "r-cur-a" in ids


# ---------------------------------------------------------------------------
# Test: save_simulation + list_simulations — reverse-chrono + cursor
# ---------------------------------------------------------------------------


class TestSaveAndListSimulations:
    def test_save_simulation_and_list_returns_it(
        self, db: FirestoreDb
    ) -> None:
        """save_simulation + list_simulations basic round-trip."""
        rec = _sim("s-basic")
        db.save_simulation(rec, org_id=_ORG)

        results = db.list_simulations(org_id=_ORG, limit=10)
        ids = [r.simulation_id for r in results]

        assert "s-basic" in ids

    def test_list_simulations_reverse_chronological(
        self, db: FirestoreDb
    ) -> None:
        """list_simulations returns newest-first."""
        t1 = _BASE
        t2 = _BASE + timedelta(hours=1)
        t3 = _BASE + timedelta(hours=2)

        db.save_simulation(_sim("s-list-a", dt=t1), org_id=_ORG)
        db.save_simulation(_sim("s-list-b", dt=t2), org_id=_ORG)
        db.save_simulation(_sim("s-list-c", dt=t3), org_id=_ORG)

        records = db.list_simulations(org_id=_ORG, limit=10)
        ids = [r.simulation_id for r in records]

        assert ids == ["s-list-c", "s-list-b", "s-list-a"], (
            f"Expected newest-first order, got: {ids}"
        )

    def test_list_simulations_cursor_pagination(self, db: FirestoreDb) -> None:
        """Cursor pagination: ``before`` yields the correct second page."""
        t1 = _BASE
        t2 = _BASE + timedelta(hours=1)
        t3 = _BASE + timedelta(hours=2)

        db.save_simulation(_sim("s-page-a", dt=t1), org_id=_ORG)
        db.save_simulation(_sim("s-page-b", dt=t2), org_id=_ORG)
        db.save_simulation(_sim("s-page-c", dt=t3), org_id=_ORG)

        # Page 1: limit=2 gets [s-page-c, s-page-b]
        page1 = db.list_simulations(org_id=_ORG, limit=2)
        assert len(page1) == 2
        assert page1[0].simulation_id == "s-page-c"
        assert page1[1].simulation_id == "s-page-b"

        # Page 2: before=t2 (the oldest record on page 1)
        page2 = db.list_simulations(org_id=_ORG, limit=2, before=t2)
        ids2 = [r.simulation_id for r in page2]
        assert "s-page-a" in ids2
        assert "s-page-b" not in ids2
        assert "s-page-c" not in ids2

    def test_list_simulations_limit_respected(self, db: FirestoreDb) -> None:
        """``limit`` parameter caps the number of returned simulations."""
        for i in range(5):
            dt = _BASE + timedelta(hours=i)
            db.save_simulation(_sim(f"s-lim-{i}", dt=dt), org_id=_ORG)

        records = db.list_simulations(org_id=_ORG, limit=3)
        assert len(records) == 3


# ---------------------------------------------------------------------------
# Test: SimRecord.scenario exact-replay round-trip
# ---------------------------------------------------------------------------


class TestScenarioRoundTrip:
    """Verify that the flat scalar/map scenario shape persists unchanged.

    The re-run path reads back the stored scenario and replays it verbatim.
    This test confirms the stored scenario is bit-for-bit identical to what
    was submitted — so re-runs are deterministic.
    """

    def test_scenario_round_trips_unchanged(self, db: FirestoreDb) -> None:
        """Saved scenario reads back identical to the original."""
        original_scenario = {
            "site": "Córdoba launch site",
            "latitude": -31.4167,
            "longitude": -64.1833,
            "elevation_m": 400.0,
            "wind_speed_ms": 7.5,
            "wind_direction_deg": 270.0,
            "rail_length_m": 3.0,
            "rail_inclination_deg": 85.0,
            "rail_heading_deg": 45.0,
            "atm": {"model": "ISA"},
        }
        rec = _sim("s-scenario-rt", scenario=original_scenario)
        db.save_simulation(rec, org_id=_ORG)

        results = db.list_simulations(org_id=_ORG, limit=1)
        assert len(results) == 1

        retrieved = results[0]
        assert retrieved.simulation_id == "s-scenario-rt"
        assert retrieved.scenario == original_scenario, (
            f"Scenario mismatch.\n"
            f"  expected: {original_scenario}\n"
            f"  got:      {retrieved.scenario}"
        )

    def test_scenario_nested_map_preserves_types(self, db: FirestoreDb) -> None:
        """Nested maps in scenario preserve float/int/str types after round-trip."""
        scenario = {
            "site": "test-site",
            "wind_speed_ms": 5.0,
            "count": 3,
            "label": "nominal",
            "nested": {"key": "value", "num": 1.23},
        }
        rec = _sim("s-types-rt", scenario=scenario)
        db.save_simulation(rec, org_id=_ORG)

        results = db.list_simulations(org_id=_ORG, limit=1)
        got = results[0].scenario

        assert got["wind_speed_ms"] == pytest.approx(5.0)
        assert got["count"] == 3
        assert got["label"] == "nominal"
        assert got["nested"]["key"] == "value"
        assert got["nested"]["num"] == pytest.approx(1.23)
