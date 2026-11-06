"""Unit tests for the Monte Carlo job queue (S9) and startup recovery (S10).

A fake process launcher replaces the worker subprocess, ``sleep`` is a no-op,
and the clock is fixed: no Monte Carlo, no real process, no wall-clock wait.
"""

from __future__ import annotations

import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from icaro_api.services.db import InMemoryDb
from icaro_api.services.montecarlo_jobs import (
    MonteCarloJob,
    MonteCarloJobQueue,
    recover_interrupted_montecarlo,
)
from icaro_api.services.storage import LocalFsStorage
from tests.fakes import FakeMonteCarloProcess, make_montecarlo_record

_ORG = "test-org"
_NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)


class _Launcher:
    """Records launch order; builds one FakeMonteCarloProcess per job."""

    def __init__(self, **per_run):
        self.launched: list[str] = []
        self.argvs: list[list[str]] = []
        self.processes: list[FakeMonteCarloProcess] = []
        self._per_run = per_run  # run_id -> FakeMonteCarloProcess kwargs or Exception

    def __call__(self, argv, stderr_file):
        prefix = Path(argv[argv.index("--output-prefix") + 1])
        run_id = prefix.parent.name
        self.launched.append(run_id)
        self.argvs.append(list(argv))
        spec = self._per_run.get(run_id, {})
        if isinstance(spec, Exception):
            raise spec
        proc = FakeMonteCarloProcess(argv, stderr_file, **spec)
        self.processes.append(proc)
        return proc


def _setup(tmp_path, launcher, *, autostart=False):
    db = InMemoryDb()
    storage = LocalFsStorage(tmp_path / "blobs")
    (tmp_path / "blobs" / "exports" / "exp-1").mkdir(parents=True)
    (tmp_path / "blobs" / "exports" / "exp-1" / "parameters.json").write_text("{}")
    queue = MonteCarloJobQueue(
        tmp_path / "runs",
        launcher=launcher,
        sleep=lambda s: None,
        clock=lambda: _NOW,
        autostart=autostart,
    )
    return db, storage, queue


def _job(db, storage, run_id, n=3):
    rec = make_montecarlo_record(run_id, org_id=_ORG, n=n)
    db.save_montecarlo(rec, org_id=_ORG)
    return MonteCarloJob(record=rec, export_prefix="exports/exp-1/", db=db, storage=storage)


def test_fifo_order_and_queue_positions(tmp_path):
    launcher = _Launcher()
    db, storage, queue = _setup(tmp_path, launcher)

    assert queue.submit(_job(db, storage, "a")) == 0
    assert queue.submit(_job(db, storage, "b")) == 1
    assert queue.submit(_job(db, storage, "c")) == 2
    assert [queue.queue_position(r) for r in ("a", "b", "c", "zz")] == [0, 1, 2, None]

    assert queue.process_next() is True
    assert [queue.queue_position(r) for r in ("a", "b", "c")] == [None, 0, 1]
    queue.process_next()
    queue.process_next()
    assert queue.process_next() is False
    assert launcher.launched == ["a", "b", "c"]


def test_successful_job_uploads_and_records_done(tmp_path):
    launcher = _Launcher()
    db, storage, queue = _setup(tmp_path, launcher)
    queue.submit(_job(db, storage, "a", n=3))

    queue.process_next()

    rec = db.get_montecarlo("a", org_id=_ORG)
    assert rec.status == "done"
    assert rec.progress_done == 3 and rec.progress_total == 3
    assert rec.result_prefix == f"orgs/{_ORG}/montecarlo/a/"
    assert rec.finished_at == _NOW and rec.error is None
    # Local absolute paths are meaningless to clients: files are blob names.
    assert rec.result["files"]["kml"] == "montecarlo.kml"
    assert rec.result["files"]["outputs"] == "montecarlo.outputs.txt"
    assert storage.open_blob(f"orgs/{_ORG}/montecarlo/a/montecarlo.kml") == b"<kml/>"
    argv = launcher.argvs[0]
    assert argv[1:3] == ["-m", "icaro_api.services.montecarlo_worker"]
    assert argv[argv.index("--n") + 1] == "3"


def test_progress_saved_from_output_line_counts(tmp_path):
    launcher = _Launcher(a={"lines": 4})
    db, storage, queue = _setup(tmp_path, launcher)
    queue.submit(_job(db, storage, "a", n=4))
    seen: list[tuple[str, int]] = []
    real_save = db.save_montecarlo

    def _spy(rec, org_id):
        seen.append((rec.status, rec.progress_done))
        real_save(rec, org_id)

    db.save_montecarlo = _spy
    queue.process_next()

    assert seen[0] == ("running", 0)
    assert [d for s, d in seen if s == "running"] == [0, 1, 2, 3, 4]
    assert seen[-1] == ("done", 4)


def test_nonzero_exit_records_bounded_stderr_tail(tmp_path):
    big = b"x" * 5000 + b"\nRuntimeError: motor file missing\n"
    launcher = _Launcher(a={"lines": 1, "returncode": 1, "stderr": big})
    db, storage, queue = _setup(tmp_path, launcher)
    queue.submit(_job(db, storage, "a"))

    queue.process_next()

    rec = db.get_montecarlo("a", org_id=_ORG)
    assert rec.status == "error"
    assert rec.error.endswith("RuntimeError: motor file missing")
    assert len(rec.error) <= 2048
    assert rec.result is None and rec.finished_at == _NOW


def test_nonzero_exit_with_empty_stderr_reports_exit_code(tmp_path):
    launcher = _Launcher(a={"lines": 0, "returncode": 137})
    db, storage, queue = _setup(tmp_path, launcher)
    queue.submit(_job(db, storage, "a"))

    queue.process_next()

    assert "137" in db.get_montecarlo("a", org_id=_ORG).error


def test_worker_thread_survives_a_failing_job(tmp_path):
    launcher = _Launcher(a=OSError("cannot spawn"))
    db, storage, queue = _setup(tmp_path, launcher, autostart=True)

    queue.submit(_job(db, storage, "a"))
    queue.submit(_job(db, storage, "b"))
    assert queue.wait_idle(timeout=10)

    a = db.get_montecarlo("a", org_id=_ORG)
    assert a.status == "error" and "cannot spawn" in a.error
    assert db.get_montecarlo("b", org_id=_ORG).status == "done"
    assert launcher.launched == ["a", "b"]


def test_only_one_job_runs_at_a_time(tmp_path):
    active = 0
    peak = 0
    lock = threading.Lock()

    class _Tracking(FakeMonteCarloProcess):
        def __init__(self, *a, **kw):
            nonlocal active, peak
            super().__init__(*a, **kw)
            with lock:
                active += 1
                peak = max(peak, active)

        def poll(self):
            nonlocal active
            rc = super().poll()
            if rc is not None and not getattr(self, "_counted", False):
                self._counted = True
                with lock:
                    active -= 1
            return rc

    db, storage, queue = _setup(tmp_path, lambda argv, err: _Tracking(argv, err), autostart=True)
    for rid in ("a", "b", "c"):
        queue.submit(_job(db, storage, rid))
    assert queue.wait_idle(timeout=10)
    assert peak == 1
    assert all(db.get_montecarlo(r, org_id=_ORG).status == "done" for r in ("a", "b", "c"))


def test_recovery_marks_unfinished_runs_as_error():
    db = InMemoryDb()
    for rid, status in (("q", "queued"), ("r", "running"), ("d", "done")):
        db.save_montecarlo(make_montecarlo_record(rid, org_id=_ORG, status=status), org_id=_ORG)
    other = make_montecarlo_record("o", org_id="org-2", status="running")
    db.save_montecarlo(other, org_id="org-2")

    count = recover_interrupted_montecarlo(db, clock=lambda: _NOW)

    assert count == 3
    for rid, org in (("q", _ORG), ("r", _ORG), ("o", "org-2")):
        rec = db.get_montecarlo(rid, org_id=org)
        assert rec.status == "error"
        assert rec.error == "interrupted by an API restart"
        assert rec.finished_at == _NOW
    assert db.get_montecarlo("d", org_id=_ORG).status == "done"


def test_local_run_dir_is_removed_after_done_and_after_error(tmp_path):
    """results_dir is a RAM-backed tmpfs on Cloud Run: nothing may be left
    behind once the run is uploaded or has failed."""
    launcher = _Launcher(b={"lines": 1, "returncode": 1, "stderr": b"boom"})
    db, storage, queue = _setup(tmp_path, launcher)
    queue.submit(_job(db, storage, "a"))
    queue.submit(_job(db, storage, "b"))

    queue.process_next()
    queue.process_next()

    assert db.get_montecarlo("a", org_id=_ORG).status == "done"
    assert db.get_montecarlo("b", org_id=_ORG).status == "error"
    assert not (tmp_path / "runs" / "a").exists()
    assert not (tmp_path / "runs" / "b").exists()
    # the uploaded copy is intact
    assert storage.open_blob(f"orgs/{_ORG}/montecarlo/a/montecarlo.kml") == b"<kml/>"


def test_subprocess_is_killed_when_a_progress_save_fails(tmp_path):
    launcher = _Launcher(a={"lines": 3})
    db, storage, queue = _setup(tmp_path, launcher)
    job = _job(db, storage, "a")
    real_save = db.save_montecarlo
    calls = {"n": 0}

    def flaky_save(rec, org_id):
        calls["n"] += 1
        if calls["n"] == 3:  # the first progress update after "running"
            raise RuntimeError("firestore down")
        real_save(rec, org_id=org_id)

    db.save_montecarlo = flaky_save
    queue.submit(job)

    queue.process_next()

    proc = launcher.processes[0]
    assert proc.killed is True
    assert db.get_montecarlo("a", org_id=_ORG).status == "error"


def test_worker_is_killed_after_the_timeout(tmp_path):
    launcher = _Launcher(a={"lines": 10_000})
    db = InMemoryDb()
    storage = LocalFsStorage(tmp_path / "blobs")
    (tmp_path / "blobs" / "exports" / "exp-1").mkdir(parents=True)
    (tmp_path / "blobs" / "exports" / "exp-1" / "parameters.json").write_text("{}")
    ticks = iter(range(0, 10_000))
    clock = lambda: datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc) + timedelta(
        seconds=next(ticks) * 10
    )
    queue = MonteCarloJobQueue(
        tmp_path / "runs", launcher=launcher, sleep=lambda s: None, clock=clock,
        autostart=False, timeout_s=60,
    )
    queue.submit(_job(db, storage, "a", n=10_000))

    queue.process_next()

    rec = db.get_montecarlo("a", org_id=_ORG)
    assert launcher.processes[0].killed is True
    assert rec.status == "error"
    assert "timed out after 60 s" in rec.error
