"""icaroRS domain layer.

Pure use-cases that orchestrate the core libraries (rocketpy, and later
rocketserializer) into meaningful operations. No I/O presentation lives here —
delivery mechanisms (CLI, API, web) call into this package and decide how to
show the results.
"""

from .simulation import simulate_from_export

__all__ = ["simulate_from_export"]
