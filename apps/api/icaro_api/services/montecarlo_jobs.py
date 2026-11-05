"""Monte Carlo job queue — one background job at a time per instance (S9, S10).

``POST /api/montecarlo`` records a ``queued`` run and submits it here. One
daemon thread drains a FIFO: for each job it marks the record ``running``,
downloads the export, launches ``icaro_api.services.montecarlo_worker`` as a
subprocess, saves progress from the line counts of the NDJSON output files
while it runs, and finally records ``done`` (result uploaded to
``orgs/{org}/montecarlo/{run_id}/``) or ``error`` (worker stderr tail).

Concurrency model
-----------------
* Exactly one worker thread per queue and one queue per process
  (``runs.get_job_queue``); with the API pinned to one Cloud Run instance
  (DEPLOY.md) that is one Monte Carlo run per deployment. The next ones wait
  in submission order; ``queue_position`` reports where.
* ``_cond`` guards ``_pending``/``_current``; a job moves from pending to
  current atomically, so a position is never reported twice or skipped.
* The heavy work runs in the child process, so ``/simulate``'s matplotlib
  lock is not involved.
* State lives in memory: a restart loses the queue. ``recover_interrupted_montecarlo``
  marks those runs ``error`` at startup (S10).

Injection points (tests): ``launcher(argv, stderr_file)`` returns a
Popen-like object (``poll()``), ``sleep(seconds)`` and ``clock()``.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from collections import deque
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, BinaryIO, Callable, Protocol

if TYPE_CHECKING:
    from icaro_api.services.db import Db, MonteCarloRecord
    from icaro_api.services.storage import Storage

logger = logging.getLogger("icaro_api.montecarlo")

WORKER_MODULE = "icaro_api.services.montecarlo_worker"
OUTPUT_NAME = "montecarlo"
STDERR_TAIL_BYTES = 2048
INTERRUPTED_ERROR = "interrupted by an API restart"
DEFAULT_TIMEOUT_S = 1800.0  # n=500 serial takes ~4 min on a laptop; generous


class ProcessLike(Protocol):
    def poll(self) -> int | None: ...

    def kill(self) -> None: ...

    def wait(self, timeout: float | None = None) -> int | None: ...


Launcher = Callable[[list[str], BinaryIO], ProcessLike]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _popen(argv: list[str], stderr_file: BinaryIO) -> subprocess.Popen:
    env = {**os.environ, "MPLBACKEND": "Agg"}
    return subprocess.Popen(  # noqa: S603 — argv is built from server-controlled paths
        argv,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=stderr_file,
        env=env,
    )


def _count_lines(path: Path) -> int:
    try:
        with open(path, "rb") as f:
            return sum(1 for _ in f)
    except OSError:
        return 0


def _tail(path: Path, limit: int = STDERR_TAIL_BYTES) -> str:
    try:
        data = path.read_bytes()
    except OSError:
        return ""
    return data[-limit:].decode("utf-8", errors="replace").strip()


@dataclass
class MonteCarloJob:
    """One submitted run: its record plus the adapters that persist it."""

    record: "MonteCarloRecord"
    export_prefix: str
    db: "Db"
    storage: "Storage"

    @property
    def run_id(self) -> str:
        return self.record.run_id


class MonteCarloJobQueue:
    """FIFO of Monte Carlo jobs served by a single background thread.

    Parameters
    ----------
    results_dir : Path
        Local run directories are created under ``results_dir/<run_id>/``.
    launcher, sleep, clock
        Injection points (see module docstring).
    poll_interval : float
        Seconds between progress polls of the running worker.
    autostart : bool
        Start the worker thread on the first ``submit``. ``False`` leaves
        jobs pending until ``process_next()`` is called (tests).
    """

    def __init__(
        self,
        results_dir: Path,
        *,
        launcher: Launcher = _popen,
        sleep: Callable[[float], None] = None,  # type: ignore[assignment]
        clock: Callable[[], datetime] = _utcnow,
        poll_interval: float = 1.0,
        autostart: bool = True,
        timeout_s: float = DEFAULT_TIMEOUT_S,
    ) -> None:
        import time

        self._results_dir = Path(results_dir)
        self._timeout_s = timeout_s
        self._launcher = launcher
        self._sleep = sleep if sleep is not None else time.sleep
        self._clock = clock
        self._poll_interval = poll_interval
        self._autostart = autostart
        self._cond = threading.Condition()
        self._pending: deque[MonteCarloJob] = deque()
        self._current: MonteCarloJob | None = None
        self._thread: threading.Thread | None = None

    # -- public API ----------------------------------------------------------

    def submit(self, job: MonteCarloJob) -> int:
        """Enqueue *job*; return its queue position (0 = next/running now)."""
        with self._cond:
            self._pending.append(job)
            position = self._position_locked(job.run_id)
            if self._autostart and (self._thread is None or not self._thread.is_alive()):
                self._thread = threading.Thread(
                    target=self._loop, name="montecarlo-worker", daemon=True
                )
                self._thread.start()
            self._cond.notify_all()
        return position  # type: ignore[return-value]

    def queue_position(self, run_id: str) -> int | None:
        """0 for the running job, 1.. for waiting ones, ``None`` if not queued here."""
        with self._cond:
            return self._position_locked(run_id)

    def process_next(self) -> bool:
        """Run the next pending job to completion. ``False`` when none is pending."""
        with self._cond:
            if not self._pending:
                return False
            self._current = self._pending.popleft()
            job = self._current
        try:
            self._run(job)
        finally:
            with self._cond:
                self._current = None
                self._cond.notify_all()
        return True

    def wait_idle(self, timeout: float | None = None) -> bool:
        """Block until no job is pending or running; ``False`` on timeout."""
        with self._cond:
            return self._cond.wait_for(
                lambda: not self._pending and self._current is None, timeout=timeout
            )

    # -- internals -------------------------------------------------------------

    def _position_locked(self, run_id: str) -> int | None:
        if self._current is not None and self._current.run_id == run_id:
            return 0
        offset = 1 if self._current is not None else 0
        for i, job in enumerate(self._pending):
            if job.run_id == run_id:
                return i + offset
        return None

    def _loop(self) -> None:
        while True:
            with self._cond:
                self._cond.wait_for(lambda: bool(self._pending))
            self.process_next()

    def _save(self, job: MonteCarloJob, **changes: Any) -> None:
        job.record = replace(job.record, **changes)
        job.db.save_montecarlo(job.record, org_id=job.record.org_id)

    def _run(self, job: MonteCarloJob) -> None:
        """Run one job; every failure is recorded, never raised (thread survives)."""
        try:
            self._save(job, status="running", progress_done=0, progress_total=job.record.n)
            self._execute(job)
        except Exception as exc:  # noqa: BLE001 — record and move on to the next job
            logger.error("Monte Carlo run %s failed", job.run_id, exc_info=True)
            try:
                self._save(job, status="error", error=str(exc) or type(exc).__name__,
                           finished_at=self._clock())
            except Exception:  # noqa: BLE001
                logger.error("Could not record failure of run %s", job.run_id, exc_info=True)

    def _execute(self, job: MonteCarloJob) -> None:
        rec = job.record
        run_dir = self._results_dir / rec.run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        try:
            self._execute_in(job, run_dir)
        finally:
            # results_dir is a RAM-backed tmpfs on Cloud Run: keep nothing local.
            shutil.rmtree(run_dir, ignore_errors=True)

    def _execute_in(self, job: MonteCarloJob, run_dir: Path) -> None:
        rec = job.record
        prefix = run_dir / OUTPUT_NAME
        counted = (Path(f"{prefix}.outputs.txt"), Path(f"{prefix}.errors.txt"))

        with tempfile.TemporaryDirectory() as tmp_str:
            tmp = Path(tmp_str)
            export_dir = tmp / "export"
            export_dir.mkdir()
            job.storage.download_dir(job.export_prefix, export_dir)
            scenario_json = tmp / "scenario.json"
            scenario_json.write_text(json.dumps(rec.scenario), encoding="utf-8")
            result_json = tmp / "result.json"
            stderr_path = tmp / "stderr.txt"
            argv = [
                sys.executable, "-m", WORKER_MODULE,
                "--export-dir", str(export_dir),
                "--scenario-json", str(scenario_json),
                "--n", str(rec.n),
                "--output-prefix", str(prefix),
                "--result-json", str(result_json),
            ]

            with open(stderr_path, "wb") as stderr_file:
                proc = self._launcher(argv, stderr_file)
                started = self._clock()
                done = 0
                timed_out = False
                try:
                    while True:
                        rc = proc.poll()
                        now_done = min(sum(_count_lines(p) for p in counted), rec.n)
                        if now_done != done:
                            done = now_done
                            self._save(job, progress_done=done)
                        if rc is not None:
                            break
                        if (self._clock() - started).total_seconds() > self._timeout_s:
                            timed_out = True
                            break
                        self._sleep(self._poll_interval)
                finally:
                    # Never leave the worker running: a failed progress save or
                    # a timeout must not orphan a CPU-bound subprocess.
                    if proc.poll() is None:
                        proc.kill()
                        proc.wait(timeout=10)

            if timed_out:
                self._save(job, status="error",
                           error=f"Monte Carlo worker timed out after {self._timeout_s:.0f} s.",
                           finished_at=self._clock())
                return
            if rc != 0:
                tail = _tail(stderr_path)
                self._save(job, status="error",
                           error=tail or f"Monte Carlo worker exited with code {rc}.",
                           finished_at=self._clock())
                return
            result = json.loads(result_json.read_text(encoding="utf-8"))

        files = result.get("files") or {}
        result["files"] = {k: (Path(v).name if v else None) for k, v in files.items()}
        result_prefix = f"orgs/{rec.org_id}/montecarlo/{rec.run_id}/"
        job.storage.upload_dir(result_prefix, run_dir)
        self._save(job, status="done", progress_done=rec.n, result=result,
                   result_prefix=result_prefix, error=None, finished_at=self._clock())


def recover_interrupted_montecarlo(
    db: "Db", clock: Callable[[], datetime] = _utcnow
) -> int:
    """Mark every queued/running run (all orgs) as ``error`` (S10).

    Called once at startup: the in-memory queue of a previous process is
    gone, so those runs will never finish. Returns how many were marked.
    """
    count = 0
    for rec in db.list_unfinished_montecarlo():
        db.save_montecarlo(
            replace(rec, status="error", error=INTERRUPTED_ERROR, finished_at=clock()),
            org_id=rec.org_id,
        )
        count += 1
    return count
