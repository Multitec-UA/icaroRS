"""Convert use-case — ORK → RocketSerializer export directory.

This module is the ONLY place in the icaro package that touches
rocketserializer / orhelper / the JVM. All imports of those libraries
are LAZY (inside the function body) so that ``import icaro`` never
requires Java or the [convert] extra to be installed.

Public API
----------
convert_ork(ork_path, output_dir=None, ork_jar=None) -> Path
    Convert a ``.ork`` file to an export directory consumable by
    :func:`icaro.simulation.simulate_from_export`.

ConvertUnavailableError
    Raised when rocketserializer / orhelper / Java are not available.
    Always contains an actionable install hint so the user knows what
    to do — never surfaces a raw ImportError traceback.

Architecture note (REQ-CVT-03, REQ-XC-03)
------------------------------------------
``rocketserializer`` is declared only under the ``[convert]`` optional
extra of ``packages/icaro/pyproject.toml``.  The default install
(simulate / mc / compare) is JVM-free.  If you find yourself adding
``import rocketserializer`` outside this file, that is an architecture
violation.
"""

from __future__ import annotations

import json
import os
from pathlib import Path


# ---------------------------------------------------------------------------
# Public exception
# ---------------------------------------------------------------------------


class ConvertUnavailableError(RuntimeError):
    """Raised when the [convert] optional extra or Java 21 is not available.

    The error message always contains an actionable install hint.

    Examples
    --------
    >>> raise ConvertUnavailableError("Install with: pip install 'icaro-cli[convert]'")
    """


# ---------------------------------------------------------------------------
# Install-hint constant (single source of truth)
# ---------------------------------------------------------------------------

_INSTALL_HINT = (
    "The [convert] optional extra is required to run convert_ork.\n"
    "Install it with:\n"
    "    pip install 'icaro-cli[convert]'\n"
    "or, if you use the icaro package directly:\n"
    "    pip install 'icaro[convert]'\n"
    "\n"
    "You also need Java 21 (or later) installed on your system and the "
    "OpenRocket .jar file available.  See NFN-4 in the icaroRS documentation."
)


# ---------------------------------------------------------------------------
# Use-case
# ---------------------------------------------------------------------------


def convert_ork(
    ork_path: str | os.PathLike,
    output_dir: str | os.PathLike | None = None,
    ork_jar: str | os.PathLike | None = None,
) -> Path:
    """Convert an OpenRocket ``.ork`` file to a RocketSerializer export directory.

    The export directory contains ``parameters.json``, ``thrust_source.csv``
    and ``drag_curve.csv`` — exactly the structure required by
    :func:`icaro.simulation.simulate_from_export`.

    This function uses a **lazy import** strategy: ``rocketserializer`` and
    ``orhelper`` are imported INSIDE the function body.  Importing the
    ``icaro`` package itself (or any other icaro module) therefore does NOT
    require the JVM toolchain (REQ-CVT-03).

    Parameters
    ----------
    ork_path : str or Path
        Path to the ``.ork`` file to convert.  Must exist.
    output_dir : str, Path, or None
        Destination directory for the export files.  When ``None``, defaults
        to a directory named after the ``.ork`` file stem in the current
        working directory (e.g. ``rocket.ork`` → ``./rocket/``).
    ork_jar : str, Path, or None
        Path to the OpenRocket ``.jar`` file.  When ``None``, the
        rocketserializer CLI searches the current directory for a file
        matching ``OpenRocket*.jar``.

    Returns
    -------
    Path
        Absolute path to the export directory.

    Raises
    ------
    ConvertUnavailableError
        If ``rocketserializer`` or ``orhelper`` cannot be imported (i.e. the
        ``[convert]`` extra is not installed or Java 21 is missing).
        The exception message contains an actionable install hint.
    FileNotFoundError
        If ``ork_path`` does not exist.

    Examples
    --------
    >>> from icaro import convert_ork
    >>> export_dir = convert_ork("rocket.ork", output_dir="./export")
    >>> print(export_dir)
    /absolute/path/to/export
    """
    # --- Resolve paths BEFORE any JVM interaction. -------------------------
    ork_path = Path(ork_path)
    if not ork_path.exists():
        raise FileNotFoundError(
            f"[convert_ork] The .ork file does not exist: {ork_path}\n"
            "Please provide a valid path to an existing OpenRocket file."
        )

    if output_dir is None:
        output_dir = Path.cwd() / ork_path.stem
    output_dir = Path(output_dir)

    # --- Lazy imports — deferred until the function is actually called. ---
    # This is the ONLY place in icaro that imports rocketserializer / orhelper.
    try:
        import orhelper  # noqa: F401 — validated; used via OpenRocketInstance
        from rocketserializer._helpers import extract_ork_from_zip, parse_ork_file
        from rocketserializer.ork_extractor import ork_extractor
    except ImportError as exc:
        raise ConvertUnavailableError(
            f"[convert_ork] Could not import rocketserializer or orhelper.\n"
            f"Original error: {exc}\n\n"
            f"{_INSTALL_HINT}"
        ) from exc

    # --- JVM-dependent pipeline (mirrors rocketserializer cli.ork2json). --
    # Step 1: unzip .ork if it is a zip archive, then parse XML.
    extract_dir = ork_path.parent
    xml_path = extract_ork_from_zip(ork_path, extract_dir)
    bs, datapoints = parse_ork_file(xml_path)

    if len(datapoints) == 0:
        raise ValueError(
            "[convert_ork] The .ork file contains no simulation data. "
            "Open the file in OpenRocket, run the simulation, then save it."
        )

    # Step 2: create output directory.
    output_dir.mkdir(parents=True, exist_ok=True)

    # Step 3: open the JVM / OpenRocket instance and extract parameters.
    jar_path = str(ork_jar) if ork_jar is not None else _find_ork_jar()

    with orhelper.OpenRocketInstance(jar_path, log_level="OFF") as instance:
        orh = orhelper.Helper(instance)
        ork_doc = orh.load_doc(str(xml_path))

        settings = ork_extractor(
            bs=bs,
            filepath=str(xml_path),
            output_folder=str(output_dir),
            ork=ork_doc,
        )

    # Step 4: write parameters.json.
    params_path = output_dir / "parameters.json"
    with open(params_path, "w", encoding="utf-8") as fh:
        json.dump(settings, fh, indent=4, sort_keys=True, ensure_ascii=False)

    return output_dir.resolve()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _find_ork_jar() -> str:
    """Search the current directory for an OpenRocket .jar file.

    Mirrors the logic in rocketserializer.cli.ork2json so the icaro wrapper
    has the same jar-discovery behavior as the underlying CLI.

    Raises
    ------
    ConvertUnavailableError
        If no OpenRocket .jar is found in the current directory.
    """
    candidates = [
        f
        for f in os.listdir(".")
        if f.startswith("OpenRocket") and f.endswith(".jar")
    ]
    if not candidates:
        raise ConvertUnavailableError(
            "[convert_ork] No OpenRocket .jar file found in the current directory.\n"
            "Pass the jar path explicitly via the ork_jar= argument, or copy the "
            ".jar to the current directory.\n\n"
            f"{_INSTALL_HINT}"
        )
    return candidates[0]
