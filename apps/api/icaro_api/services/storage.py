"""Storage service — blob I/O abstraction (Design §Interfaces, REQ-02).

Two adapters:

* ``LocalFsStorage`` — copies directories and files on local disk.
  Used in dev and CI (zero GCP dependency).
* ``GcsStorage`` — wraps ``google-cloud-storage``.  Used in production
  when ``Settings.gcs_bucket`` is set.

The ``Storage`` Protocol is the ONLY surface the routers touch; swapping
adapters is purely a ``get_storage()`` concern.

GCS object key scheme (REQ-02.7, org-scoped since issue #45)
--------------------------------------------------------------
* Export artifacts:   ``orgs/{org_id}/exports/{rocket_id}/{filename}``
* Simulation results: ``orgs/{org_id}/results/{simulation_id}/{filename}``

Callers never reconstruct these keys from ``rocket_id``/``simulation_id``
alone — the prefix is always read from the record's stored
``export_prefix``/``result_prefix`` (``routers/convert.py``,
``routers/simulate.py``, ``routers/results.py``). This is what lets the
pre-#45 flat scheme (``exports/{rocket_id}/...``,
``results/{simulation_id}/...``) coexist with the org-scoped one on
existing records without a migration flag day.

This scheme is documented here; ``get_storage()`` in ``runs.py`` is the
single call site that resolves which adapter to use.
"""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Protocol, runtime_checkable


@runtime_checkable
class Storage(Protocol):
    """Blob storage abstraction used by all routers.

    Parameters
    ----------
    upload_dir
        Recursively upload every file in *local_dir* under *prefix*.
        Key = ``{prefix}{filename}`` for each file (no subdirectory nesting).
    download_dir
        Download every blob whose key starts with *prefix* into *dest*.
        Creates *dest* if it does not exist.
    open_blob
        Return the raw bytes of the blob at *key*.
        Raises ``KeyError`` if the blob does not exist.
    exists
        Return ``True`` if at least one blob with key prefix *prefix* exists.
    """

    def upload_dir(self, prefix: str, local_dir: Path) -> None:
        """Upload all files under *local_dir* to *prefix* in the store."""
        ...

    def download_dir(self, prefix: str, dest: Path) -> None:
        """Download all blobs under *prefix* into *dest*."""
        ...

    def open_blob(self, key: str) -> bytes:
        """Return the raw bytes of blob *key*.

        Raises
        ------
        KeyError
            If *key* does not exist.
        """
        ...

    def exists(self, prefix: str) -> bool:
        """Return ``True`` if any blob with key prefix *prefix* exists."""
        ...


class LocalFsStorage:
    """Local-filesystem storage adapter for dev and CI.

    All blobs are stored under *root_dir* (default: a temporary directory
    created by the caller).  The key is the blob path relative to *root_dir*.

    Parameters
    ----------
    root_dir : Path
        Root directory where blobs are stored.
    """

    def __init__(self, root_dir: Path) -> None:
        self._root = root_dir
        self._root.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Storage protocol
    # ------------------------------------------------------------------

    def upload_dir(self, prefix: str, local_dir: Path) -> None:
        """Copy every file in *local_dir* to ``{root}/{prefix}{filename}``.

        Only top-level files are copied (no subdirectory recursion).
        This matches the GCS flat-prefix convention used by the routers.
        """
        dest_prefix = self._root / prefix
        dest_prefix.mkdir(parents=True, exist_ok=True)
        for src in local_dir.iterdir():
            if src.is_file():
                shutil.copy2(src, dest_prefix / src.name)

    def download_dir(self, prefix: str, dest: Path) -> None:
        """Copy every blob under *prefix* into *dest*.

        Creates *dest* if it does not exist.
        """
        src_prefix = self._root / prefix
        dest.mkdir(parents=True, exist_ok=True)
        if not src_prefix.exists():
            return
        for blob in src_prefix.iterdir():
            if blob.is_file():
                shutil.copy2(blob, dest / blob.name)

    def open_blob(self, key: str) -> bytes:
        """Return the raw bytes of blob at *key*.

        Raises
        ------
        KeyError
            If the blob file does not exist.
        """
        path = self._root / key
        if not path.exists():
            raise KeyError(key)
        return path.read_bytes()

    def exists(self, prefix: str) -> bool:
        """Return ``True`` if the prefix directory exists and has at least one file."""
        path = self._root / prefix
        if not path.exists():
            return False
        return any(p.is_file() for p in path.iterdir())


class GcsStorage:
    """Google Cloud Storage adapter for production.

    Wraps ``google.cloud.storage.Client``.  Requires
    ``google-cloud-storage`` to be installed (not in base deps — add to
    the ``[gcs]`` optional extra).

    Parameters
    ----------
    bucket_name : str
        GCS bucket name (from ``Settings.gcs_bucket``).
    """

    def __init__(self, bucket_name: str) -> None:
        from google.cloud import storage as gcs  # type: ignore[import]

        self._client = gcs.Client()
        self._bucket = self._client.bucket(bucket_name)

    # ------------------------------------------------------------------
    # Storage protocol
    # ------------------------------------------------------------------

    def upload_dir(self, prefix: str, local_dir: Path) -> None:
        """Upload every file in *local_dir* as ``{prefix}{filename}``."""
        for src in local_dir.iterdir():
            if src.is_file():
                blob = self._bucket.blob(f"{prefix}{src.name}")
                blob.upload_from_filename(str(src))

    def download_dir(self, prefix: str, dest: Path) -> None:
        """Download every blob under *prefix* into *dest*."""
        dest.mkdir(parents=True, exist_ok=True)
        blobs = list(self._bucket.list_blobs(prefix=prefix))
        for blob in blobs:
            filename = blob.name[len(prefix):]
            if not filename:
                continue
            (dest / filename).write_bytes(blob.download_as_bytes())

    def open_blob(self, key: str) -> bytes:
        """Return the raw bytes of blob *key*.

        Raises
        ------
        KeyError
            If the blob does not exist in GCS.
        """
        from google.cloud.exceptions import NotFound  # type: ignore[import]

        blob = self._bucket.blob(key)
        try:
            return blob.download_as_bytes()
        except NotFound:
            raise KeyError(key)

    def exists(self, prefix: str) -> bool:
        """Return ``True`` if any blob with key prefix *prefix* exists."""
        blobs = list(self._bucket.list_blobs(prefix=prefix, max_results=1))
        return len(blobs) > 0
