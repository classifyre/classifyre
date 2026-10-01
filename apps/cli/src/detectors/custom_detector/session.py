"""Parent-side runtime for one code detector over one scan.

A :class:`CustomDetectorSession` owns the detector's notebook child
process(es), installs its packages, downloads its files, runs ``setup()`` once
per child and ``detect()`` once per asset, serving payload lazily from the
source's shared :class:`AssetPayloadServer`.

It never raises into the pipeline. Every per-asset outcome is a
:class:`DetectOutcome`: findings on success, an error string otherwise. The
pipeline turns an error into a scan warning and an ``ERROR`` detector outcome,
which is what keeps a broken rule from resolving anything it found before
(PRD G1 R17). After ``max_consecutive_failures`` the session disables itself
for the rest of the run and every later call reports why.
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ...models.generated_single_asset_scan_results import DetectionResult
from ...notebook.child import ChildProcessError, NotebookChildProcess
from ...notebook.groups import warm_declared_groups
from ...notebook.packages import install as install_packages
from ...pipeline.asset_payload_server import AssetPayloadServer
from .contract import validate_detector_notebook
from .files import materialize_detector_files
from .results import FindingMapper

logger = logging.getLogger(__name__)

RUNNER_MODULE = "src.detectors.custom_detector.runner"

DEFAULT_LIMITS: dict[str, int] = {
    "per_asset_timeout_seconds": 30,
    "setup_timeout_seconds": 900,
    "max_findings_per_asset": 200,
    "max_output_bytes": 2_097_152,
    "max_payload_bytes": 33_554_432,
    "max_workers": 1,
    "max_consecutive_failures": 10,
}

#: One package install at a time per process: two detectors resolving into the
#: same venv concurrently is how an install corrupts itself.
_INSTALL_LOCK = asyncio.Lock()


def _plain(value: Any) -> Any:
    """A pydantic model or a mapping, as plain JSON-shaped data."""
    if hasattr(value, "model_dump"):
        return value.model_dump(mode="json", exclude_none=True)
    return value


def limits_of(schema: Mapping[str, Any]) -> dict[str, int]:
    limits = dict(DEFAULT_LIMITS)
    raw = schema.get("limits")
    if isinstance(raw, Mapping):
        for key in limits:
            value = raw.get(key)
            if value is None or isinstance(value, bool):
                continue
            try:
                limits[key] = int(value)
            except (TypeError, ValueError):
                logger.warning("Ignoring invalid code-detector limit %r=%r", key, value)
    limits["max_workers"] = max(1, min(8, limits["max_workers"]))
    for key in (
        "per_asset_timeout_seconds",
        "setup_timeout_seconds",
        "max_findings_per_asset",
        "max_consecutive_failures",
    ):
        limits[key] = max(1, limits[key])
    limits["max_output_bytes"] = max(1024, limits["max_output_bytes"])
    limits["max_payload_bytes"] = max(1024, limits["max_payload_bytes"])
    return limits


@dataclass
class DetectOutcome:
    findings: list[DetectionResult] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    error: str | None = None
    elapsed_ms: int = 0

    @property
    def ok(self) -> bool:
        return self.error is None


@dataclass
class _Slot:
    child: NotebookChildProcess
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    ready: bool = False
    setup_done: bool = False


@dataclass
class SessionStats:
    assets: int = 0
    failed: int = 0
    findings: int = 0


class CustomDetectorSession:
    """Runs one code detector's notebook over one scan."""

    def __init__(
        self,
        *,
        key: str,
        name: str,
        schema: Any,
        source: Any = None,
        payloads: Any = None,
        stderr: Any = None,
    ) -> None:
        self.key = key
        self.name = name or key
        self._schema: dict[str, Any] = dict(_plain(schema) or {})
        notebook = self._schema.get("notebook")
        notebook = notebook if isinstance(notebook, Mapping) else {}
        self._cells: list[Any] = list(notebook.get("cells") or [])
        self.revision = int(notebook.get("revision") or 1)
        self.needs_findings = bool(self._schema.get("needs_findings"))
        self._limits = limits_of(self._schema)
        self._source = source
        self._payloads = payloads
        self._slots = [
            _Slot(NotebookChildProcess(RUNNER_MODULE, stderr=stderr))
            for _ in range(self._limits["max_workers"])
        ]
        self._prepared = False
        self._prepare_error: str | None = None
        self._prepare_lock = asyncio.Lock()
        self._files_dir: Path | None = None
        self._disabled_reason: str | None = None
        self._consecutive_failures = 0
        self.stats = SessionStats()
        self.warnings: list[str] = []
        self._warning_set: set[str] = set()
        self.mapper = FindingMapper(
            key=key,
            name=self.name,
            severity=self._schema.get("severity"),
            category=self._schema.get("category"),
            fields=self._schema.get("fields") or [],
            max_findings=self._limits["max_findings_per_asset"],
            warn=self._warn,
        )

    # -- properties --------------------------------------------------------------

    @property
    def limits(self) -> dict[str, int]:
        return dict(self._limits)

    @property
    def disabled_reason(self) -> str | None:
        return self._disabled_reason

    def _payload_server(self) -> Any:
        if self._payloads is None:
            self._payloads = AssetPayloadServer.shared(
                self._source, max_payload_bytes=self._limits["max_payload_bytes"]
            )
        return self._payloads

    # -- lifecycle ---------------------------------------------------------------------

    def _handshake(self) -> dict[str, Any]:
        source = self._source
        recipe = getattr(source, "recipe", None)
        sampling = recipe.get("sampling") if isinstance(recipe, Mapping) else None
        return {
            "detector": {
                "key": self.key,
                "name": self.name,
                "notebook": {"cells": self._cells},
                "variables": self._schema.get("variables") or {},
                "secrets": self._schema.get("secrets") or {},
                "needs_findings": self.needs_findings,
                "files_dir": str(self._files_dir) if self._files_dir else None,
                "sampling": sampling if isinstance(sampling, Mapping) else {},
            },
            "source": {
                "type": str(getattr(source, "source_type", "") or ""),
                "source_id": getattr(source, "source_id", None),
            },
        }

    async def _prepare(self) -> None:
        """Validate, install packages, fetch files. Once per session."""
        async with self._prepare_lock:
            if self._prepared:
                if self._prepare_error:
                    raise ChildProcessError(self._prepare_error)
                return
            self._prepared = True
            try:
                report = validate_detector_notebook(self._cells)
                if not report.ok:
                    raise ChildProcessError(
                        "The detector's notebook does not satisfy the contract: "
                        + "; ".join(v.message for v in report.violations)
                    )
                declared = [_plain(entry) for entry in self._schema.get("packages") or []]
                async with _INSTALL_LOCK:
                    await asyncio.to_thread(warm_declared_groups, self._cells)
                    if declared:
                        install = await asyncio.to_thread(install_packages, declared)
                        if install.error:
                            raise ChildProcessError(
                                f"Could not install the detector's packages: {install.error}"
                            )
                        if install.skipped_reason:
                            self._warn(install.skipped_reason)
                self._files_dir = await asyncio.to_thread(
                    materialize_detector_files,
                    self._schema.get("custom_detector_id"),
                    self._schema.get("files_runtime"),
                )
            except ChildProcessError as exc:
                self._prepare_error = str(exc)
                raise
            except Exception as exc:
                self._prepare_error = f"Could not prepare the detector: {exc}"
                raise ChildProcessError(self._prepare_error) from exc

    async def _ready_slot(self, slot: _Slot) -> None:
        await self._prepare()
        if not slot.ready:
            try:
                await asyncio.to_thread(slot.child.start, self._handshake())
            except ChildProcessError:
                raise
            except Exception as exc:
                raise ChildProcessError(f"Could not start the detector process: {exc}") from exc
            slot.ready = True
            slot.setup_done = False
        if not slot.setup_done:
            try:
                await asyncio.wait_for(
                    slot.child.call("setup"),
                    timeout=self._limits["setup_timeout_seconds"],
                )
            except TimeoutError as exc:
                self._reset(slot)
                raise ChildProcessError(
                    f"setup() timed out after {self._limits['setup_timeout_seconds']}s"
                ) from exc
            except ChildProcessError as exc:
                self._reset(slot)
                raise ChildProcessError(f"setup() failed: {exc}") from exc
            slot.setup_done = True

    def _reset(self, slot: _Slot) -> None:
        slot.child.terminate()
        slot.ready = False
        slot.setup_done = False

    def _pick_slot(self) -> _Slot:
        for slot in self._slots:
            if not slot.lock.locked():
                return slot
        return self._slots[0]

    def close(self) -> None:
        for slot in self._slots:
            try:
                slot.child.terminate()
            except Exception:
                pass
            slot.ready = False
            slot.setup_done = False
        if self._files_dir is not None and "classifyre-detector-files-" in str(self._files_dir):
            shutil.rmtree(self._files_dir, ignore_errors=True)
        self._files_dir = None

    # -- per asset -------------------------------------------------------------------------

    @staticmethod
    def snapshot(asset: Any, source: Any = None) -> dict[str, Any]:
        metadata = getattr(asset, "metadata", None)
        metadata = dict(metadata) if isinstance(metadata, Mapping) else {}
        mime = (
            getattr(asset, "mime_type", None)
            or metadata.get("mime_type")
            or metadata.get("content_type")
        )
        return {
            "hash": str(getattr(asset, "hash", "") or ""),
            "id": str(metadata.get("external_id") or getattr(asset, "hash", "") or ""),
            "name": str(getattr(asset, "name", "") or ""),
            "kind": str(getattr(asset, "asset_kind", "") or ""),
            "url": str(getattr(asset, "external_url", "") or ""),
            "urn": getattr(asset, "urn", None),
            "source_type": str(getattr(source, "source_type", "") or ""),
            "metadata": json.loads(json.dumps(metadata, default=str)),
            "mime_type": str(mime) if mime else None,
        }

    async def detect(self, asset: Any, prior_findings: list[Any] | None = None) -> DetectOutcome:
        """Judge one asset. Never raises."""
        loop = asyncio.get_running_loop()
        started = loop.time()
        name = str(getattr(asset, "name", "") or getattr(asset, "hash", "") or "?")
        if self._disabled_reason:
            return DetectOutcome(error=self._disabled_reason)
        snapshot = self.snapshot(asset, self._source)
        if not snapshot["hash"]:
            return DetectOutcome(error="asset has no hash")
        findings_payload = (
            [prior_finding_payload(item) for item in prior_findings or []]
            if self.needs_findings
            else None
        )
        warnings_before = len(self.warnings)
        slot = self._pick_slot()
        async with slot.lock:
            try:
                await self._ready_slot(slot)
                payloads = self._payload_server()

                async def serve(frame: dict[str, Any]) -> Any:
                    return await payloads.serve(asset, frame)

                raw = await asyncio.wait_for(
                    slot.child.call(
                        "detect", on_need=serve, asset=snapshot, findings=findings_payload
                    ),
                    timeout=self._limits["per_asset_timeout_seconds"],
                )
                findings = self._accept(raw, name)
            except TimeoutError:
                self._reset(slot)
                return self._failed(
                    f"detect() timed out after {self._limits['per_asset_timeout_seconds']}s",
                    started,
                )
            except Exception as exc:
                if not slot.child.running:
                    self._reset(slot)
                return self._failed(str(exc) or type(exc).__name__, started)

        self._consecutive_failures = 0
        self.stats.assets += 1
        self.stats.findings += len(findings)
        outcome = DetectOutcome(
            findings=findings,
            warnings=self.warnings[warnings_before:],
            elapsed_ms=int((loop.time() - started) * 1000),
        )
        child_warnings = raw.get("warnings") if isinstance(raw, Mapping) else None
        for message in child_warnings or []:
            outcome.warnings.append(f"{self.key} on {name}: {message}")
        return outcome

    def _accept(self, raw: Any, asset_name: str) -> list[DetectionResult]:
        if not isinstance(raw, Mapping) or not isinstance(raw.get("findings"), list):
            raise ValueError("detect() returned a malformed result")
        size = len(json.dumps(raw["findings"], default=str))
        if size > self._limits["max_output_bytes"]:
            raise ValueError(
                f"detect() output is {size} bytes, over the {self._limits['max_output_bytes']}"
                "-byte limit"
            )
        return self.mapper.map(raw["findings"], asset_name=asset_name)

    def _failed(self, message: str, started: float) -> DetectOutcome:
        self.stats.failed += 1
        self._consecutive_failures += 1
        elapsed = int((asyncio.get_running_loop().time() - started) * 1000)
        if self._consecutive_failures >= self._limits["max_consecutive_failures"]:
            self._disabled_reason = (
                f"disabled after {self._consecutive_failures} consecutive failures "
                f"(last: {message})"
            )
            self._warn(f"Code detector {self.key!r} {self._disabled_reason}")
            self.close()
        return DetectOutcome(error=message, elapsed_ms=elapsed)

    def _warn(self, message: str) -> None:
        if message in self._warning_set:
            return
        self._warning_set.add(message)
        if len(self.warnings) < 100:
            self.warnings.append(message)
        logger.warning("%s", message)

    def summary(self) -> dict[str, Any]:
        return {
            "key": self.key,
            "assets": self.stats.assets,
            "failed": self.stats.failed,
            "findings": self.stats.findings,
            "disabled": self._disabled_reason,
        }


def prior_finding_payload(finding: Any) -> dict[str, Any]:
    """What ``asset.findings`` exposes of another detector's finding."""
    data = _plain(finding)
    if not isinstance(data, Mapping):
        return {}
    if "finding_type" not in data and "type" in data:
        # Already in this shape: a preview's findings come from the API.
        return dict(data)
    detector = data.get("detector_type")
    location = data.get("location") if isinstance(data.get("location"), Mapping) else {}
    metadata = data.get("metadata") if isinstance(data.get("metadata"), Mapping) else {}
    return {
        "detector": str(getattr(detector, "value", detector) or ""),
        "custom_detector_key": data.get("custom_detector_key"),
        "type": str(data.get("finding_type") or ""),
        "value": str(data.get("matched_content") or ""),
        "severity": str(getattr(data.get("severity"), "value", data.get("severity")) or ""),
        "confidence": data.get("confidence") or 0.0,
        "location": dict(location),
        "metadata": {
            key: value
            for key, value in metadata.items()
            if key in {"tabular_row_index", "tabular_column_name", "entity_label", "label"}
        },
    }


__all__ = [
    "DEFAULT_LIMITS",
    "CustomDetectorSession",
    "DetectOutcome",
    "limits_of",
    "prior_finding_payload",
]
