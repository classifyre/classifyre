"""Asset fixtures: a whole asset in one JSON file, for code-detector tests.

A code detector judges assets, not strings: it reads rows, pages, metadata and
the kind of asset it is looking at. A test scenario that could only hand it
text would test the wrong thing, so a scenario may carry an *asset fixture*
instead (PRD G1 R23)::

    {
      "name": "bevoelkerung-2024.csv",
      "kind": "table",
      "mime_type": "text/csv",
      "metadata": {"table_code": "12411-0001"},
      "text": "...",              # optional; defaults to the joined pages
      "pages": ["...", "..."],    # optional extracted text, page by page
      "rows": [{"total": 3, ...}] # optional records, served by asset.rows()
    }

It travels as a file named ``*.classifyre-asset.json`` so the same
``evaluate-file`` job that runs text scenarios runs these too. The payload
server below serves the fixture exactly where a live source would be asked.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Mapping
from pathlib import Path
from types import SimpleNamespace
from typing import Any

FIXTURE_SUFFIX = ".classifyre-asset.json"


def is_asset_fixture(path: Path) -> bool:
    return path.name.endswith(FIXTURE_SUFFIX)


def load_asset_fixture(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("An asset fixture must be a JSON object")
    return data


def fixture_text(fixture: Mapping[str, Any]) -> str:
    text = fixture.get("text")
    if isinstance(text, str):
        return text
    pages = fixture.get("pages")
    if isinstance(pages, list):
        return "\n".join(str(page) for page in pages)
    rows = fixture.get("rows")
    if isinstance(rows, list):
        return "\n".join(json.dumps(row, ensure_ascii=False) for row in rows)
    return ""


def fixture_asset(fixture: Mapping[str, Any], fallback_name: str) -> SimpleNamespace:
    name = str(fixture.get("name") or fallback_name)
    metadata = fixture.get("metadata")
    metadata = dict(metadata) if isinstance(metadata, Mapping) else {}
    mime = fixture.get("mime_type")
    if isinstance(mime, str) and mime:
        metadata.setdefault("mime_type", mime)
    return SimpleNamespace(
        hash=str(fixture.get("hash") or f"fixture:{name}"),
        name=name,
        asset_kind=str(fixture.get("kind") or "file"),
        external_url=str(fixture.get("url") or f"fixture://{name}"),
        urn=fixture.get("urn"),
        metadata=metadata,
        mime_type=mime if isinstance(mime, str) else None,
    )


class StaticPayloadServer:
    """Serves one in-memory asset through the ``need`` protocol shapes."""

    def __init__(
        self,
        *,
        payload: tuple[bytes, str] | None,
        raw_pages: list[str],
        text_pages: list[str],
    ) -> None:
        self._payload = payload
        self._raw_pages = raw_pages
        self._text_pages = text_pages

    @classmethod
    def from_fixture(cls, fixture: Mapping[str, Any]) -> StaticPayloadServer:
        rows = fixture.get("rows")
        raw_pages: list[str] = []
        if isinstance(rows, list):
            raw_pages = [json.dumps([row for row in rows if isinstance(row, Mapping)])]
        elif isinstance(fixture.get("raw_pages"), list):
            raw_pages = [str(page) for page in fixture["raw_pages"]]
        pages = fixture.get("pages")
        text = fixture_text(fixture)
        text_pages = [str(page) for page in pages] if isinstance(pages, list) else [text]
        payload: tuple[bytes, str] | None = None
        encoded = fixture.get("bytes_b64")
        mime = str(fixture.get("mime_type") or "text/plain")
        if isinstance(encoded, str) and encoded:
            payload = (base64.b64decode(encoded), mime)
        elif text:
            payload = (text.encode("utf-8"), mime)
        return cls(payload=payload, raw_pages=raw_pages, text_pages=text_pages)

    @classmethod
    def from_file(cls, raw: bytes, mime: str, text: str) -> StaticPayloadServer:
        raw_pages: list[str] = []
        if mime in {"application/json", "application/x-ndjson", "application/jsonl"}:
            raw_pages = [raw.decode("utf-8", errors="replace")]
        return cls(payload=(raw, mime), raw_pages=raw_pages, text_pages=[text] if text else [])

    async def serve(self, asset: Any, frame: Mapping[str, Any]) -> dict[str, Any]:
        op = str(frame.get("op") or "")
        if op == "payload":
            if self._payload is None:
                return {"bytes_b64": None, "mime": None}
            raw, mime = self._payload
            return {"bytes_b64": base64.b64encode(raw).decode("ascii"), "mime": mime}
        if op == "raw_pages":
            return {"pages": list(self._raw_pages)}
        if op == "text":
            return {"text": "".join(self._text_pages), "pages": list(self._text_pages)}
        raise ValueError(f"Unknown payload op {op!r}")

    def evict(self, asset: Any) -> None:
        return None


__all__ = [
    "FIXTURE_SUFFIX",
    "StaticPayloadServer",
    "fixture_asset",
    "fixture_text",
    "is_asset_fixture",
    "load_asset_fixture",
]
