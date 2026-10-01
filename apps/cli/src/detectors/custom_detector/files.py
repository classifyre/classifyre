"""Materialize a code detector's uploaded files for ``ctx.file(name)``.

Downloaded by the parent, never by the child: the child is started without the
API URL or the callback key, and handing it either would undo the isolation it
exists for. The API injects ``files_runtime`` -- one entry per file, with a
content hash and a download URL -- into the pipeline schema at dispatch.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import tempfile
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests

from ...outputs.base import DEFAULT_REST_TIMEOUT_SEC
from ...outputs.rest import INTERNAL_KEY_HEADER
from ...utils.source_files import CHUNK_BYTES, api_base_url

logger = logging.getLogger(__name__)

#: A directory prepared by the caller (the preview job's init container, a
#: test) wins over downloading.
FILES_DIR_ENV = "CLASSIFYRE_DETECTOR_FILES_DIR"


def _safe_name(name: str) -> str:
    base = Path(name).name or "file"
    return re.sub(r"[^A-Za-z0-9._ -]", "_", base)[:200] or "file"


def _entries(files_runtime: Iterable[Any] | None) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for raw in files_runtime or []:
        entry = raw.model_dump() if hasattr(raw, "model_dump") else raw
        if isinstance(entry, Mapping) and entry.get("id") and entry.get("name"):
            entries.append(dict(entry))
    return entries


def materialize_detector_files(
    detector_id: str | None,
    files_runtime: Iterable[Any] | None,
) -> Path | None:
    """Download every file into a fresh temp dir; None when there are none.

    A file that fails to download is logged and skipped: a rule that reads one
    list out of three should still see the two that arrived, and a rule that
    needs the missing one fails loudly on ``ctx.file(name)`` with its name.
    """
    prepared = os.environ.get(FILES_DIR_ENV)
    if prepared and Path(prepared).is_dir():
        return Path(prepared)
    entries = _entries(files_runtime)
    if not entries:
        return None
    destination = Path(tempfile.mkdtemp(prefix="classifyre-detector-files-"))
    headers = {"Connection": "close"}
    key = os.environ.get("CLASSIFYRE_INTERNAL_KEY", "").strip()
    if key:
        headers[INTERNAL_KEY_HEADER] = key
    written = 0
    with requests.Session() as session:
        for entry in entries:
            url = str(entry.get("url") or "").strip()
            if not url:
                if not detector_id:
                    continue
                url = (
                    f"{api_base_url()}/custom-detectors/{quote(detector_id, safe='')}"
                    f"/files/{quote(str(entry['id']), safe='')}/content"
                )
            target = destination / _safe_name(str(entry["name"]))
            try:
                with session.get(
                    url, headers=headers, stream=True, timeout=(30, DEFAULT_REST_TIMEOUT_SEC)
                ) as response:
                    response.raise_for_status()
                    with target.open("wb") as handle:
                        for chunk in response.iter_content(chunk_size=CHUNK_BYTES):
                            if chunk:
                                handle.write(chunk)
            except (requests.RequestException, OSError) as exc:
                logger.warning("Could not download detector file %s: %s", entry.get("name"), exc)
                target.unlink(missing_ok=True)
                continue
            written += 1
    if not written:
        shutil.rmtree(destination, ignore_errors=True)
        return None
    logger.info("Made %d detector file(s) available to ctx.files", written)
    return destination


__all__ = ["FILES_DIR_ENV", "materialize_detector_files"]
