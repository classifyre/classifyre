"""Reading a source's uploaded files from the API.

Files uploaded to a source live in Postgres, and the CLI reaches them over the
same managed-job API base URL the REST output sink uses. Two sources need this
and need it differently: SANDBOX turns each file into an asset, while CUSTOM
downloads them to disk so a notebook can open them as ordinary paths -- and in
that case the download deliberately happens in the *parent* process, because the
notebook's own process is started without the API URL at all.

One copy of the endpoint shapes, so the two cannot drift.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

from ..outputs.base import DEFAULT_REST_TIMEOUT_SEC

logger = logging.getLogger(__name__)

#: Read in chunks rather than whole: an uploaded file has no size ceiling.
CHUNK_BYTES = 1024 * 1024


def api_base_url() -> str:
    """Where the managed-job API lives, from the environment the CLI was given."""
    return (
        os.environ.get("CLASSIFYRE_OUTPUT_REST_URL")
        or os.environ.get("API_URL")
        or "http://localhost:8000"
    ).rstrip("/")


def request(
    session: requests.Session, api_url: str, path: str, *, stream: bool = False
) -> requests.Response:
    """One GET against the API, with the timeouts a large download needs.

    The read budget applies per socket read, so it is generous for a streamed
    download of any size -- a single flat timeout would apply to connect and to
    a multi-gigabyte body alike.
    """
    response = session.request(
        "GET",
        f"{api_url}{path}",
        timeout=(30, DEFAULT_REST_TIMEOUT_SEC),
        stream=stream,
        headers={"Connection": "close"},
    )
    response.raise_for_status()
    return response


def list_source_files(
    session: requests.Session, api_url: str, source_id: str
) -> list[dict[str, Any]]:
    """Metadata for every file uploaded to a source."""
    payload = request(session, api_url, f"/sources/{source_id}/files").json()
    if not isinstance(payload, list):
        raise ValueError("Source files API returned a non-array response")
    return [item for item in payload if isinstance(item, dict) and item.get("id")]


def stream_source_file(
    session: requests.Session, api_url: str, source_id: str, file_id: str
) -> tuple[Iterator[bytes], str | None]:
    """A chunk iterator over one file's bytes, plus its served content type."""
    response = request(
        session,
        api_url,
        f"/sources/{source_id}/files/{quote(file_id, safe='')}/content",
        stream=True,
    )
    return response.iter_content(chunk_size=CHUNK_BYTES), response.headers.get("Content-Type")


def download_source_files(
    session: requests.Session, api_url: str, source_id: str, destination: Path
) -> int:
    """Write every uploaded file into ``destination``, named as it was uploaded.

    Returns how many landed. A file that fails to download is logged and skipped
    rather than failing the run: one bad attachment should not stop a connector
    that reads the other twenty.
    """
    destination.mkdir(parents=True, exist_ok=True)
    written = 0
    for metadata in list_source_files(session, api_url, source_id):
        file_id = str(metadata["id"])
        name = _safe_name(str(metadata.get("fileName") or file_id))
        target = _unique_target(destination, name, file_id)
        try:
            chunks, _ = stream_source_file(session, api_url, source_id, file_id)
            with target.open("wb") as handle:
                for chunk in chunks:
                    if chunk:
                        handle.write(chunk)
        except (requests.RequestException, OSError, ValueError) as exc:
            logger.warning("Could not download uploaded file %s (%s): %s", name, file_id, exc)
            target.unlink(missing_ok=True)
            continue
        written += 1
    return written


def _unique_target(destination: Path, name: str, file_id: str) -> Path:
    """Where to write a file whose name another upload already claimed.

    Two uploads can share a name (dedupe is by content hash, not by name), and
    silently overwriting one with the other would hand the notebook fewer files
    than the source has. The id disambiguates, and stays in the name so the file
    is still identifiable.
    """
    target = destination / name
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    return destination / f"{stem}-{file_id[:8]}{suffix}"


def _safe_name(file_name: str) -> str:
    """The upload's own name, reduced to a single path component.

    The API already stores a basename, but this directory is handed to user code
    as a real filesystem path, so a name that escaped it would be a directory
    traversal rather than a filename.
    """
    name = Path(file_name).name.strip()
    return name if name and name not in {".", ".."} else "upload"
