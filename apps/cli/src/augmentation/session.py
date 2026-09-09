"""Parent-side augmentation runtime: one session per scan.

An :class:`AugmentationSession` owns the notebook child process(es), serves
lazy payload on demand, and is the **single place that writes**: ``apply_patch``
is where a patch becomes metadata/tags/links/URN/edges, and anything else in
the patch is ignored with a warning. The child is never trusted to write
directly, so a compromised or buggy notebook cannot touch what the connector
extracted.

Failure containment: every call is wrapped. A child that fails to start, a
package install that fails, a raised exception, a timeout, or a malformed patch
produces a scan *warning* and the asset proceeds exactly as if augmentation
were disabled. After ``max_consecutive_failures`` the session disables itself
for the rest of the run and warns once. Counters in :meth:`summary` keep a
silently-degraded run visible.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from ..graph.edges import edge_from_payload
from ..notebook.child import ChildProcessError, NotebookChildProcess
from ..notebook.groups import warm_declared_groups
from ..notebook.packages import install as install_packages
from ..utils.hashing import unhash_id
from ..utils.urn import normalize_urn_or_none
from .contract import validate_augmentation_notebook

logger = logging.getLogger(__name__)

#: Child entry point, launched with a scrubbed environment.
RUNNER_MODULE = "src.augmentation.runner"

#: Drain buffered edges mid-run once this many are waiting. ``drain_edges()``
#: is documented as periodic but the end-of-run call is the only one that
#: exists today; augmentation can produce an edge per asset, so Phase 2 flushes
#: past this threshold instead of holding a whole scan's lineage in memory.
EDGE_FLUSH_THRESHOLD = 200

_DEFAULT_LIMITS = {
    "timeout_seconds": 900,
    "per_asset_timeout_seconds": 30,
    "max_payload_bytes": 33_554_432,
    "max_output_bytes": 2_097_152,
    "max_workers": 1,
    "max_consecutive_failures": 10,
}


def augmentation_config_of(recipe: Mapping[str, Any] | None) -> dict[str, Any]:
    """The ``augmentation`` section of a source recipe, or ``{}``."""
    if not isinstance(recipe, Mapping):
        return {}
    section = recipe.get("augmentation")
    return dict(section) if isinstance(section, dict) else {}


def augmentation_enabled(recipe: Mapping[str, Any] | None) -> bool:
    """Whether the recipe asks for augmentation at all."""
    return bool(augmentation_config_of(recipe).get("enabled", False))


def augmentation_revision(recipe: Mapping[str, Any] | None) -> int:
    """Monotonic notebook revision, for the scan-cache signature."""
    notebook = augmentation_config_of(recipe).get("notebook")
    if not isinstance(notebook, dict):
        return 0
    try:
        return int(notebook.get("revision") or 0)
    except (TypeError, ValueError):
        return 0


def _limits_of(section: Mapping[str, Any]) -> dict[str, Any]:
    limits = dict(_DEFAULT_LIMITS)
    raw = section.get("limits")
    if isinstance(raw, dict):
        for key in limits:
            value = raw.get(key)
            if isinstance(value, bool) or value is None:
                continue
            try:
                limits[key] = int(value)
            except (TypeError, ValueError):
                logger.warning("Ignoring invalid augmentation limit %r=%r", key, value)
    limits["max_workers"] = max(1, min(8, limits["max_workers"]))
    for key in ("timeout_seconds", "per_asset_timeout_seconds", "max_consecutive_failures"):
        limits[key] = max(1, limits[key])
    limits["max_payload_bytes"] = max(1024, limits["max_payload_bytes"])
    return limits


@dataclass
class _ChildSlot:
    child: NotebookChildProcess
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    ready: bool = False


@dataclass
class AugmentationStats:
    assets_augmented: int = 0
    assets_failed: int = 0
    assets_skipped_cache: int = 0
    edges: int = 0
    tags: int = 0


class AugmentationSession:
    """Runs one source's augmentation notebook over one scan."""

    def __init__(
        self,
        recipe: dict[str, Any],
        source: Any,
        *,
        section: dict[str, Any] | None = None,
    ) -> None:
        self._recipe = recipe
        self._source = source
        self._section = dict(section) if section is not None else augmentation_config_of(recipe)
        notebook = self._section.get("notebook")
        notebook = notebook if isinstance(notebook, dict) else {}
        self._cells = notebook.get("cells") if isinstance(notebook.get("cells"), list) else []
        self._revision = augmentation_revision(recipe)
        self._limits = _limits_of(self._section)
        self._slots: list[_ChildSlot] = [
            _ChildSlot(NotebookChildProcess(RUNNER_MODULE))
            for _ in range(self._limits["max_workers"])
        ]
        self._packages_installed = False
        self._setup_done: set[int] = set()
        self._disabled = False
        self._disable_reason = ""
        self._consecutive_failures = 0
        self._warnings: list[str] = []
        self._warning_set: set[str] = set()
        self.stats = AugmentationStats()
        # Run-scoped memo of fetched payloads, keyed by fetch candidate id.
        # Bounded: one in-flight asset's worth per entry, each capped at
        # max_payload_bytes, dropped by evict_asset_cache().
        self._memo: dict[str, dict[str, Any]] = {}

    # -- construction ----------------------------------------------------------

    @classmethod
    def from_recipe(cls, recipe: dict[str, Any], source: Any) -> AugmentationSession | None:
        """Build the session, or None when augmentation is absent/disabled.

        Absent means provably inert: not even a child process is started, and
        the source behaves exactly as before.
        """
        section = augmentation_config_of(recipe)
        if not section.get("enabled", False):
            return None
        cells = (
            (section.get("notebook") or {}).get("cells")
            if isinstance(section.get("notebook"), dict)
            else None
        )
        if not cells:
            logger.warning(
                "Augmentation is enabled but has no notebook cells; "
                "proceeding as if augmentation were disabled."
            )
            return None
        return cls(recipe, source, section=section)

    @property
    def enabled(self) -> bool:
        return not self._disabled

    @property
    def revision(self) -> int:
        return self._revision

    @property
    def warnings(self) -> list[str]:
        return list(self._warnings)

    # -- lifecycle ---------------------------------------------------------------

    def _handshake(self) -> dict[str, Any]:
        return {
            "recipe": json.loads(json.dumps(self._recipe, default=str)),
            "source": {
                "type": getattr(self._source, "source_type", ""),
                "source_id": getattr(self._source, "source_id", None),
            },
        }

    def _ensure_packages(self) -> None:
        if self._packages_installed:
            return
        self._packages_installed = True
        warm_declared_groups(self._cells)
        declared = self._section.get("packages") or []
        if not declared:
            return
        dumped = [dict(entry) if isinstance(entry, dict) else entry for entry in declared]
        report = install_packages(dumped)
        if report.error:
            raise ChildProcessError(
                f"Could not install the augmentation notebook's packages: {report.error}"
            )
        if report.skipped_reason:
            logger.warning("%s", report.skipped_reason)

    def _assert_folders_exist(self) -> None:
        for entry in self._section.get("local_folders") or []:
            if not isinstance(entry, dict):
                continue
            from pathlib import Path

            path = Path(str(entry.get("path") or ""))
            if not path.is_dir():
                raise ChildProcessError(
                    f"Local folder {entry.get('name')!r} points at {path}, which is not "
                    "a directory. The folder must be mounted where the scan runs."
                )

    async def _slot(self, index: int) -> _ChildSlot:
        """Start (on first use) and set up the child in one slot."""
        slot = self._slots[index]
        if not slot.ready:
            cells: list[Any] = list(self._cells or [])
            report = validate_augmentation_notebook(cells)
            if not report.ok:
                raise ChildProcessError(
                    "Augmentation notebook does not satisfy the contract: "
                    + "; ".join(v.message for v in report.violations)
                )
            self._ensure_packages()
            self._assert_folders_exist()
            try:
                await asyncio.to_thread(slot.child.start, self._handshake())
            except ChildProcessError:
                raise
            except Exception as exc:
                raise ChildProcessError(f"Could not start augmentation process: {exc}") from exc
            slot.ready = True
        if index not in self._setup_done:
            try:
                await asyncio.wait_for(
                    slot.child.call("setup"),
                    timeout=self._limits["timeout_seconds"],
                )
            except ChildProcessError as exc:
                raise ChildProcessError(f"Augmentation setup() failed: {exc}") from exc
            except TimeoutError as exc:
                raise ChildProcessError(
                    f"Augmentation setup() timed out after {self._limits['timeout_seconds']}s"
                ) from exc
            self._setup_done.add(index)
        return slot

    async def startup(self) -> None:
        """Validate, install packages and run ``setup()``. Warns, never raises."""
        if self._disabled:
            return
        try:
            await self._slot(0)
        except Exception as exc:
            self._fail_run(f"Augmentation disabled: {exc}")

    async def finish(self) -> None:
        """Run ``finalize()`` on every worker that ran ``setup()``, then stop."""
        if self._disabled:
            self.close()
            return
        for index in sorted(self._setup_done):
            slot = self._slots[index]
            if not slot.ready:
                continue
            try:
                result = await asyncio.wait_for(
                    slot.child.call("finalize"),
                    timeout=self._limits["timeout_seconds"],
                )
                self._ingest_edges(result, asset_hash=None)
            except Exception as exc:
                self._warn(f"Augmentation finalize() failed: {exc}")
        self.close()

    def close(self) -> None:
        for slot in self._slots:
            try:
                slot.child.terminate()
            except Exception:
                pass
        self._memo.clear()

    # -- per asset -----------------------------------------------------------------

    def _snapshot(self, asset: Any) -> dict[str, Any]:
        metadata = getattr(asset, "metadata", None)
        metadata = dict(metadata) if isinstance(metadata, dict) else {}
        return {
            "hash": str(getattr(asset, "hash", "") or ""),
            "id": str(metadata.get("external_id") or getattr(asset, "hash", "") or ""),
            "name": str(getattr(asset, "name", "") or ""),
            "kind": str(getattr(asset, "asset_kind", "") or ""),
            "url": str(getattr(asset, "external_url", "") or ""),
            "urn": getattr(asset, "urn", None),
            "source_type": getattr(self._source, "source_type", ""),
            "metadata": metadata,
            "mime_type": None,
        }

    def _candidates(self, asset: Any) -> list[str]:
        seen: list[str] = []
        for candidate in (getattr(asset, "external_url", ""), getattr(asset, "hash", "")):
            value = str(candidate or "").strip()
            if value and value not in seen:
                seen.append(value)
        return seen

    async def _serve_need(self, asset: Any, memo_key: str, frame: dict[str, Any]) -> Any:
        op = str(frame.get("op") or "")
        if op == "payload":
            fetched = await self._fetch_payload(asset)
            if fetched is None:
                return {"bytes_b64": None, "mime": None}
            raw, mime = fetched
            return {"bytes_b64": base64.b64encode(raw).decode("ascii"), "mime": mime}
        if op == "raw_pages":
            pages = await self._fetch_raw_pages(asset)
            return {"pages": pages}
        if op == "text":
            pages = await self._fetch_text_pages(asset)
            whole = "".join(pages)
            return {"text": whole, "pages": pages}
        raise ChildProcessError(f"Unknown payload op {op!r}")

    async def _fetch_payload(self, asset: Any) -> tuple[bytes, str] | None:
        """Raw bytes for file-shaped sources; None for row-shaped ones."""
        memo = self._memo_for(asset)
        if "payload" in memo:
            cached = memo["payload"]
            return cached if cached is None else (bytes(cached[0]), str(cached[1]))
        fetch = getattr(self._source, "fetch_content_bytes", None)
        result: tuple[bytes, str] | None = None
        if callable(fetch):
            for candidate in self._candidates(asset):
                try:
                    result = await fetch(candidate)
                except Exception as exc:
                    logger.debug("Augmentation payload fetch failed for %s: %s", candidate, exc)
                    continue
                if result is not None:
                    break
        if result is not None:
            raw, mime = result
            cap = self._limits["max_payload_bytes"]
            if len(raw) > cap:
                logger.debug("Augmentation payload for %s truncated to %d bytes", candidate, cap)
                raw = raw[:cap]
            result = (raw, mime)
            self._remember_bytes(asset, raw, mime)
        memo["payload"] = result
        return result

    async def _fetch_raw_pages(self, asset: Any) -> list[str]:
        """The connector's own raw representation, page by page (capped)."""
        memo = self._memo_for(asset)
        if "raw_pages" in memo:
            return [str(page) for page in memo["raw_pages"]]
        pages: list[str] = []
        fetch = getattr(self._source, "fetch_content_pages", None)
        cap = self._limits["max_payload_bytes"]
        used = 0
        if callable(fetch):
            for candidate in self._candidates(asset):
                try:
                    async for raw, _text in fetch(candidate):
                        if not raw:
                            continue
                        chunk = str(raw)
                        if used + len(chunk) > cap:
                            chunk = chunk[: max(0, cap - used)]
                        if chunk:
                            pages.append(chunk)
                            used += len(chunk)
                        if used >= cap or len(pages) >= 50:
                            break
                    if pages:
                        break
                except Exception as exc:
                    logger.debug("Augmentation raw fetch failed for %s: %s", candidate, exc)
                    continue
        memo["raw_pages"] = pages
        return pages

    async def _fetch_text_pages(self, asset: Any) -> list[str]:
        """Extracted text, page by page (capped)."""
        memo = self._memo_for(asset)
        if "text_pages" in memo:
            return [str(page) for page in memo["text_pages"]]
        pages: list[str] = []
        fetch = getattr(self._source, "fetch_content_pages", None)
        cap = self._limits["max_payload_bytes"]
        used = 0
        if callable(fetch):
            for candidate in self._candidates(asset):
                try:
                    async for _raw, text in fetch(candidate):
                        if not text:
                            continue
                        chunk = str(text)
                        if used + len(chunk) > cap:
                            chunk = chunk[: max(0, cap - used)]
                        if chunk:
                            pages.append(chunk)
                            used += len(chunk)
                        if used >= cap or len(pages) >= 50:
                            break
                    if pages:
                        break
                except Exception as exc:
                    logger.debug("Augmentation text fetch failed for %s: %s", candidate, exc)
                    continue
        if not pages:
            provider = getattr(self._source, "fetch_content_bytes", None)
            if callable(provider):
                fetched = await self._fetch_payload(asset)
                if fetched is not None:
                    raw, mime = fetched
                    try:
                        text_pages = await asyncio.to_thread(
                            list, self._source.iter_asset_pages(raw, mime)
                        )
                        for page in text_pages[:50]:
                            chunk = str(page)
                            if used + len(chunk) > cap:
                                chunk = chunk[: max(0, cap - used)]
                            if chunk:
                                pages.append(chunk)
                                used += len(chunk)
                            if used >= cap:
                                break
                    except Exception as exc:
                        logger.debug("Augmentation text fallback failed: %s", exc)
        memo["text_pages"] = pages
        return pages

    def _memo_for(self, asset: Any) -> dict[str, Any]:
        key = str(getattr(asset, "hash", "") or "")
        return self._memo.setdefault(key, {})

    def _remember_bytes(self, asset: Any, raw: bytes, mime: str) -> None:
        """Mirror fetched bytes onto the source so the pipeline reuses them.

        ``ParsedContentProvider.fetch_bytes`` consults this memo first instead
        of re-downloading — the fetch augmentation already paid for is not
        paid twice. Registered under every candidate id the pipeline tries
        (external URL, then hash), and dropped by ``evict`` at the end of the
        asset.
        """
        remember = getattr(self._source, "remember_augmentation_bytes", None)
        if not callable(remember):
            return
        for candidate in self._candidates(asset):
            try:
                remember(candidate, raw, mime)
            except Exception:
                pass

    async def augment(self, asset: Any) -> Any:
        """Enrich one asset. Never raises: failure degrades to a warning."""
        if self._disabled:
            return asset
        asset_hash = str(getattr(asset, "hash", "") or "")
        snapshot = self._snapshot(asset)
        if not snapshot["hash"]:
            return asset
        slot = self._pick_slot()
        async with slot.lock:
            try:
                if not slot.ready or slot.child is None:
                    await self._slot(self._slots.index(slot))

                async def serve(frame: dict[str, Any]) -> Any:
                    return await self._serve_need(asset, asset_hash, frame)

                raw_patch = await asyncio.wait_for(
                    slot.child.call("augment", on_need=serve, asset=snapshot),
                    timeout=self._limits["per_asset_timeout_seconds"],
                )
                patch = raw_patch if isinstance(raw_patch, dict) else {}
                self.apply_patch(asset, patch)
                self._consecutive_failures = 0
                self.stats.assets_augmented += 1
            except TimeoutError:
                slot.child.terminate()
                slot.ready = False
                self._setup_done.discard(self._slots.index(slot))
                self._fail_asset(
                    asset, f"augment() timed out after {self._limits['per_asset_timeout_seconds']}s"
                )
            except Exception as exc:
                self._fail_asset(asset, f"augment() failed: {exc}")
        # Flush lineage past the threshold: holding a whole scan's edges until
        # the end is how a chatty notebook turns into an OOM.
        try:
            if self._source.pending_edge_count() >= EDGE_FLUSH_THRESHOLD:
                self._flush_requested = True
        except Exception:
            pass
        return asset

    def _pick_slot(self) -> _ChildSlot:
        # The per-slot lock is the real mutex; this only spreads load. When
        # every worker is busy the first slot's `async with` waits its turn.
        for slot in self._slots:
            if not slot.lock.locked():
                return slot
        return self._slots[0]

    @property
    def flush_requested(self) -> bool:
        return bool(getattr(self, "_flush_requested", False))

    def clear_flush_request(self) -> None:
        self._flush_requested = False

    # -- patch application: the single place that writes ---------------------------

    def apply_patch(self, asset: Any, patch: Any) -> None:
        """Apply a patch additively. Anything outside the patch shape is ignored."""
        if not isinstance(patch, dict):
            self._warn(f"Ignoring malformed augmentation patch for {getattr(asset, 'name', '?')}")
            return
        asset_hash = str(getattr(asset, "hash", "") or "")

        metadata = patch.get("metadata")
        if isinstance(metadata, dict) and metadata:
            current = getattr(asset, "metadata", None)
            if not isinstance(current, dict):
                current = {}
                try:
                    asset.metadata = current
                except Exception:
                    pass
            namespaced = current.setdefault("augmentation", {})
            if isinstance(namespaced, dict):
                for key, value in metadata.items():
                    name = str(key or "").strip()
                    if not name:
                        continue
                    try:
                        json.dumps(value)
                    except (TypeError, ValueError):
                        self._warn(f"Ignoring non-JSON augmentation metadata {name!r}")
                        continue
                    namespaced[name] = value

        tags = patch.get("tags")
        if isinstance(tags, dict) and tags:
            clean = {
                str(key).strip(): str(value).strip()
                for key, value in tags.items()
                if str(key).strip() and str(value).strip()
            }
            if clean:
                record = getattr(self._source, "record_augmentation_tags", None)
                if callable(record):
                    record(asset_hash, clean)
                self.stats.tags += len(clean)

        links = patch.get("links")
        if isinstance(links, list) and links:
            current_links = getattr(asset, "links", None)
            if isinstance(current_links, list):
                for link in links:
                    target = str(link or "").strip()
                    if target and target not in current_links:
                        current_links.append(target)

        urn = patch.get("urn")
        if isinstance(urn, str) and urn.strip():
            if not getattr(asset, "urn", None):
                normalized = normalize_urn_or_none(urn)
                if normalized is not None:
                    try:
                        asset.urn = normalized
                    except Exception:
                        pass
                else:
                    self._warn(f"Ignoring invalid augmentation URN {urn!r}")

        self._ingest_edges(patch, asset_hash=asset_hash or None)

        for message in patch.get("warnings") or []:
            self._warn(f"Augmentation on {getattr(asset, 'name', asset_hash)}: {message}")

    def _ingest_edges(self, patch: Any, *, asset_hash: str | None) -> None:
        edges = patch.get("edges") if isinstance(patch, dict) else None
        if not edges:
            return
        if not isinstance(edges, list):
            self._warn("Ignoring malformed augmentation edges (not a list)")
            return
        resolved: list[Any] = []
        for payload in edges:
            if not isinstance(payload, dict):
                continue
            try:
                edge = edge_from_payload(payload)
            except Exception as exc:
                self._warn(f"Ignoring malformed augmentation edge: {exc}")
                continue
            try:
                from dataclasses import replace

                edge = replace(
                    edge,
                    frm=self._resolve_ref(edge.frm),
                    to=self._resolve_ref(edge.to),
                    via=None if edge.via is None else self._resolve_ref(edge.via),
                ).to_ingest()
            except Exception as exc:
                self._warn(f"Ignoring unresolvable augmentation edge: {exc}")
                continue
            resolved.append(edge)
        if resolved:
            try:
                self._source.add_edges(resolved)
                self.stats.edges += len(resolved)
            except Exception as exc:
                self._warn(f"Could not buffer augmentation edges: {exc}")

    def _resolve_ref(self, ref: Any) -> Any:
        """Notebook hash-or-id -> asset hash. URNs pass through untouched."""
        from ..graph.edges import Ref

        if not isinstance(ref, Ref) or ref.kind != "asset":
            return ref
        value = str(ref.value or "").strip()
        if not value:
            return ref
        if self._looks_like_asset_hash(value):
            # asset.ref hands the notebook a finished hash. Hashing it again
            # makes an endpoint the API can never resolve, so a same-scan
            # edge silently drops (relationshipsDropped).
            return ref
        generate = getattr(self._source, "generate_hash_id", None)
        if callable(generate):
            try:
                # Plain connector ids resolve here.
                return Ref("asset", generate(value))
            except Exception:
                pass
        return ref

    def _looks_like_asset_hash(self, value: str) -> bool:
        """Whether value is already this source's finished asset hash."""
        if value.startswith("url_sha256:"):
            return True
        try:
            decoded = unhash_id(value)
        except Exception:
            return False
        prefix, separator, _ = decoded.partition("_#_")
        source_type = str(getattr(self._source, "source_type", "") or "")
        return bool(separator) and prefix.upper() == source_type.upper()

    # -- failure handling ------------------------------------------------------------

    def _warn(self, message: str) -> None:
        message = str(message)
        if message in self._warning_set:
            return
        self._warning_set.add(message)
        if len(self._warnings) < 50:
            self._warnings.append(message)
        logger.warning("%s", message)

    def _fail_asset(self, asset: Any, message: str) -> None:
        self.stats.assets_failed += 1
        self._consecutive_failures += 1
        name = getattr(asset, "name", None) or getattr(asset, "hash", "?")
        if self._consecutive_failures >= self._limits["max_consecutive_failures"]:
            self._fail_run(
                f"Augmentation disabled after {self._consecutive_failures} consecutive "
                f"failures (last: asset {name}: {message})"
            )
            return
        self._warn(f"{message} on asset {name}; ingesting it unchanged")

    def _fail_run(self, message: str) -> None:
        if self._disabled:
            return
        self._disabled = True
        self._disable_reason = message
        self._warn(message)
        self.close()

    def summary(self) -> dict[str, Any]:
        """Counters for the run summary, so a degraded run stays visible."""
        return {
            "enabled": True,
            "disabled": self._disabled,
            "disable_reason": self._disable_reason,
            "revision": self._revision,
            "assets_augmented": self.stats.assets_augmented,
            "assets_failed": self.stats.assets_failed,
            "tags_asserted": self.stats.tags,
            "edges": self.stats.edges,
            "warnings": len(self._warnings),
        }

    def evict(self, asset: Any) -> None:
        """Drop one asset's payload memo. Called alongside evict_asset_cache."""
        self._memo.pop(str(getattr(asset, "hash", "") or ""), None)
        forget = getattr(self._source, "forget_augmentation_bytes", None)
        if not callable(forget):
            return
        # The bytes were mirrored under every candidate id; drop them all.
        for candidate in self._candidates(asset):
            try:
                forget(candidate)
            except Exception:
                pass
