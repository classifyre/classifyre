"""Lazy, per-asset payload for notebook children: fetched once, shared.

Augmentation and code detectors (``CODE_DETECTOR``) both run user code in a
child process that asks for an asset's payload mid-call — ``payload``,
``raw_pages`` or ``text`` — through the ``need``/``provide`` protocol. Both
consumers can run on the same asset in the same scan: augmentation before the
detector stage, then any number of code detectors inside it. Without a shared
memo each of them would re-download the same object, so the fetch logic lives
here once and every consumer asks the one server attached to the source.

The memo is per asset and bounded by ``max_payload_bytes`` per entry. The run
loop drops an asset's entry once the asset is finished (``evict``), so a scan
never holds more than its in-flight assets' payloads.
"""

from __future__ import annotations

import asyncio
import base64
import logging
from typing import Any

logger = logging.getLogger(__name__)

DEFAULT_MAX_PAYLOAD_BYTES = 33_554_432

#: Pages served per op. A notebook that needs more reads the payload itself.
MAX_PAGES = 50

_ATTRIBUTE = "_classifyre_asset_payload_server"


class AssetPayloadServer:
    """Serves ``payload`` / ``raw_pages`` / ``text`` for assets of one source."""

    def __init__(self, source: Any, *, max_payload_bytes: int = DEFAULT_MAX_PAYLOAD_BYTES) -> None:
        self._source = source
        self.max_payload_bytes = max(1024, int(max_payload_bytes))
        self._memo: dict[str, dict[str, Any]] = {}

    # -- sharing ---------------------------------------------------------------

    @classmethod
    def shared(cls, source: Any, *, max_payload_bytes: int | None = None) -> AssetPayloadServer:
        """The one server for ``source``, created on first use.

        A later caller that needs a larger cap raises it: the cap bounds memory,
        and serving a detector less than it asked for because augmentation was
        configured first would be a silent truncation.
        """
        server = getattr(source, _ATTRIBUTE, None)
        if not isinstance(server, cls):
            server = cls(
                source,
                max_payload_bytes=max_payload_bytes or DEFAULT_MAX_PAYLOAD_BYTES,
            )
            try:
                setattr(source, _ATTRIBUTE, server)
            except Exception:  # pragma: no cover - a source that refuses attributes
                pass
        elif max_payload_bytes and max_payload_bytes > server.max_payload_bytes:
            server.max_payload_bytes = int(max_payload_bytes)
        return server

    @classmethod
    def evict_shared(cls, source: Any, asset: Any) -> None:
        server = getattr(source, _ATTRIBUTE, None)
        if isinstance(server, cls):
            server.evict(asset)

    # -- protocol ----------------------------------------------------------------

    async def serve(self, asset: Any, frame: dict[str, Any]) -> dict[str, Any]:
        """Answer one ``need`` frame with the shapes the child SDKs read."""
        op = str(frame.get("op") or "")
        if op == "payload":
            fetched = await self.payload(asset)
            if fetched is None:
                return {"bytes_b64": None, "mime": None}
            raw, mime = fetched
            return {"bytes_b64": base64.b64encode(raw).decode("ascii"), "mime": mime}
        if op == "raw_pages":
            return {"pages": await self.raw_pages(asset)}
        if op == "text":
            pages = await self.text_pages(asset)
            return {"text": "".join(pages), "pages": pages}
        raise ValueError(f"Unknown payload op {op!r}")

    # -- fetchers ------------------------------------------------------------------

    @staticmethod
    def candidates(asset: Any) -> list[str]:
        """Ids a source may know this asset by: its URL first, then its hash."""
        seen: list[str] = []
        for candidate in (getattr(asset, "external_url", ""), getattr(asset, "hash", "")):
            value = str(candidate or "").strip()
            if value and value not in seen:
                seen.append(value)
        return seen

    def _memo_for(self, asset: Any) -> dict[str, Any]:
        return self._memo.setdefault(str(getattr(asset, "hash", "") or ""), {})

    async def payload(self, asset: Any) -> tuple[bytes, str] | None:
        """Raw bytes for file-shaped sources; None for row-shaped ones."""
        memo = self._memo_for(asset)
        if "payload" in memo:
            cached = memo["payload"]
            return cached if cached is None else (bytes(cached[0]), str(cached[1]))
        fetch = getattr(self._source, "fetch_content_bytes", None)
        result: tuple[bytes, str] | None = None
        if callable(fetch):
            for candidate in self.candidates(asset):
                try:
                    result = await fetch(candidate)
                except Exception as exc:
                    logger.debug("Payload fetch failed for %s: %s", candidate, exc)
                    continue
                if result is not None:
                    break
        if result is not None:
            raw, mime = result
            if len(raw) > self.max_payload_bytes:
                logger.debug("Payload truncated to %d bytes", self.max_payload_bytes)
                raw = raw[: self.max_payload_bytes]
            result = (raw, mime)
            self._remember_bytes(asset, raw, mime)
        memo["payload"] = result
        return result

    async def raw_pages(self, asset: Any) -> list[str]:
        """The connector's own raw representation, page by page (capped)."""
        memo = self._memo_for(asset)
        if "raw_pages" in memo:
            return [str(page) for page in memo["raw_pages"]]
        pages = await self._collect_pages(asset, use_raw=True)
        memo["raw_pages"] = pages
        return pages

    async def text_pages(self, asset: Any) -> list[str]:
        """Extracted text, page by page (capped)."""
        memo = self._memo_for(asset)
        if "text_pages" in memo:
            return [str(page) for page in memo["text_pages"]]
        pages = await self._collect_pages(asset, use_raw=False)
        if not pages:
            pages = await self._text_from_bytes(asset)
        memo["text_pages"] = pages
        return pages

    async def _collect_pages(self, asset: Any, *, use_raw: bool) -> list[str]:
        pages: list[str] = []
        fetch = getattr(self._source, "fetch_content_pages", None)
        if not callable(fetch):
            return pages
        cap = self.max_payload_bytes
        used = 0
        for candidate in self.candidates(asset):
            try:
                async for raw, text in fetch(candidate):
                    value = raw if use_raw else text
                    if not value:
                        continue
                    chunk = str(value)
                    if used + len(chunk) > cap:
                        chunk = chunk[: max(0, cap - used)]
                    if chunk:
                        pages.append(chunk)
                        used += len(chunk)
                    if used >= cap or len(pages) >= MAX_PAGES:
                        break
                if pages:
                    break
            except Exception as exc:
                logger.debug("Page fetch failed for %s: %s", candidate, exc)
                continue
        return pages

    async def _text_from_bytes(self, asset: Any) -> list[str]:
        """Parse the payload when the source has no page reader of its own."""
        if not callable(getattr(self._source, "fetch_content_bytes", None)):
            return []
        fetched = await self.payload(asset)
        if fetched is None:
            return []
        raw, mime = fetched
        iter_pages = getattr(self._source, "iter_asset_pages", None)
        if not callable(iter_pages):
            return []
        pages: list[str] = []
        used = 0
        cap = self.max_payload_bytes
        try:
            text_pages = await asyncio.to_thread(list, iter_pages(raw, mime))
        except Exception as exc:
            logger.debug("Text fallback failed: %s", exc)
            return []
        for page in text_pages[:MAX_PAGES]:
            chunk = str(page)
            if used + len(chunk) > cap:
                chunk = chunk[: max(0, cap - used)]
            if chunk:
                pages.append(chunk)
                used += len(chunk)
            if used >= cap:
                break
        return pages

    # -- memo lifecycle ---------------------------------------------------------------

    def _remember_bytes(self, asset: Any, raw: bytes, mime: str) -> None:
        """Mirror fetched bytes onto the source so the text pass reuses them.

        ``ParsedContentProvider.fetch_bytes`` consults this memo before
        downloading, so a fetch a notebook already paid for is not paid twice.
        """
        remember = getattr(self._source, "remember_augmentation_bytes", None)
        if not callable(remember):
            return
        for candidate in self.candidates(asset):
            try:
                remember(candidate, raw, mime)
            except Exception:
                pass

    def evict(self, asset: Any) -> None:
        """Drop one asset's memo and the bytes mirrored onto the source."""
        self._memo.pop(str(getattr(asset, "hash", "") or ""), None)
        forget = getattr(self._source, "forget_augmentation_bytes", None)
        if not callable(forget):
            return
        for candidate in self.candidates(asset):
            try:
                forget(candidate)
            except Exception:
                pass

    def clear(self) -> None:
        self._memo.clear()


__all__ = ["DEFAULT_MAX_PAYLOAD_BYTES", "AssetPayloadServer"]
