"""Process-wide simulate lock — single import point (ADR-3, RG-9.2).

``_SIMULATE_LOCK`` is a module-level ``threading.Lock()`` that serializes ALL
``POST /api/simulate`` requests.

Rationale (ADR-3)
-----------------
matplotlib pyplot global state + the Agg backend are NOT thread-safe.  Two
concurrent ``flight.plots.*`` calls in the same process can corrupt figures.
The lock ensures only one Flight is being rendered at any time.

The simulate endpoint acquires this lock for the entire
``simulate_from_export`` + ``serialize_flight`` block, then releases it.

Forward path
------------
Replace ``threading.Lock()`` with a ``ProcessPoolExecutor(max_workers=N)``
so each Flight runs in its own subprocess with isolated matplotlib state.
Because the endpoint already returns a ``run_id`` and writes ``result.json``
to the run dir, this swap is an INTERNAL change with no contract break.

Usage
-----
Import the lock here; do NOT create a second Lock elsewhere::

    from icaro_api.simulate_lock import _SIMULATE_LOCK

    with _SIMULATE_LOCK:
        result = simulate_and_serialize(...)
"""

import threading

#: Process-wide lock serializing all simulate requests.
#: Acquired by ``POST /api/simulate`` for the full simulate + serialize block.
_SIMULATE_LOCK: threading.Lock = threading.Lock()
