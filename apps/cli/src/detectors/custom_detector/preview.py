"""Preview a code detector on real assets: ``preview_detect``.

The author picks a source and (optionally) one of its assets; this runs the
detector's ``setup()`` and ``detect()`` exactly as a scan would -- same child
process, same payload server, same finding mapping -- and reports what it
would record. Nothing is ingested and no run is created.

With an asset, the asset is judged directly: the API sends what it knows of
it (hash, URL, kind, metadata, current findings) and the payload is fetched
from the live source on demand. Without one, a small RANDOM sample of the
source's assets is extracted first, the same way ``preview_augment`` does.
"""

from __future__ import annotations

import copy
import logging
import os
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from ...notebook.protocol import (
    ExecutionError,
    ExecutionMode,
    ExecutionRequest,
    ExecutionResponse,
    ExecutionStatus,
)
from ...pipeline.asset_payload_server import AssetPayloadServer
from .contract import validate_detector_notebook
from .files import FILES_DIR_ENV
from .runner import redactor_for
from .session import CustomDetectorSession

logger = logging.getLogger(__name__)

DEFAULT_PREVIEW_ASSETS = 3
MAX_PREVIEW_ASSETS = 10
MAX_LOG_BYTES = 64 * 1024
MAX_FINDINGS_SHOWN = 100

#: What a preview snapshots of each asset so the author can keep it as a test
#: fixture ("capture from asset"). Small on purpose: a fixture is a test case,
#: and it is stored in Postgres and shipped to an evaluation job.
FIXTURE_MAX_ROWS = 50
FIXTURE_MAX_PAGES = 5
FIXTURE_MAX_CHARS = 20_000

#: Where the API (or the Job's init container) put the detector's files.
NOTEBOOK_FILES_DIR_ENV = "CLASSIFYRE_NOTEBOOK_FILES_DIR"


def detector_schema(detector: dict[str, Any] | None) -> dict[str, Any]:
    schema = (detector or {}).get("pipeline_schema")
    return dict(schema) if isinstance(schema, dict) else {}


def detector_cells(detector: dict[str, Any] | None) -> list[Any]:
    notebook = detector_schema(detector).get("notebook")
    cells = notebook.get("cells") if isinstance(notebook, dict) else None
    return list(cells) if isinstance(cells, list) else []


def _error(type_: str, message: str) -> ExecutionError:
    return ExecutionError(type=type_, message=message)


def _stub_asset(raw: dict[str, Any]) -> SimpleNamespace:
    metadata = raw.get("metadata")
    return SimpleNamespace(
        hash=str(raw.get("hash") or ""),
        name=str(raw.get("name") or raw.get("hash") or ""),
        asset_kind=str(raw.get("assetKind") or raw.get("asset_kind") or raw.get("kind") or ""),
        external_url=str(raw.get("externalUrl") or raw.get("external_url") or ""),
        urn=raw.get("urn"),
        metadata=dict(metadata) if isinstance(metadata, dict) else {},
        mime_type=raw.get("mimeType") or raw.get("mime_type"),
    )


def _finding_view(finding: Any) -> dict[str, Any]:
    data = finding.model_dump(mode="json", exclude_none=True)
    return {
        key: data[key]
        for key in (
            "finding_type",
            "matched_content",
            "severity",
            "confidence",
            "category",
            "location",
            "metadata",
            "extracted_data",
            "identity_key",
        )
        if key in data
    }


async def _fixture_of(asset: Any, payloads: AssetPayloadServer) -> dict[str, Any]:
    """A bounded snapshot of the asset, in the test-fixture shape."""
    from ...augmentation.sdk import _parse_record_page

    metadata = getattr(asset, "metadata", None)
    fixture: dict[str, Any] = {
        "name": str(getattr(asset, "name", "") or "asset"),
        "kind": str(getattr(asset, "asset_kind", "") or ""),
        "metadata": dict(metadata) if isinstance(metadata, dict) else {},
    }
    mime = getattr(asset, "mime_type", None)
    if mime:
        fixture["mime_type"] = str(mime)
    rows: list[dict[str, Any]] = []
    try:
        for page in await payloads.raw_pages(asset):
            for row in _parse_record_page(page):
                rows.append(row)
                if len(rows) >= FIXTURE_MAX_ROWS:
                    break
            if len(rows) >= FIXTURE_MAX_ROWS:
                break
    except Exception as exc:  # a snapshot is a convenience, never a failure
        logger.debug("Fixture rows unavailable: %s", exc)
    if rows:
        fixture["rows"] = rows
    try:
        pages: list[str] = []
        used = 0
        for page in (await payloads.text_pages(asset))[:FIXTURE_MAX_PAGES]:
            chunk = page[: max(0, FIXTURE_MAX_CHARS - used)]
            if not chunk:
                break
            pages.append(chunk)
            used += len(chunk)
        if pages:
            fixture["pages"] = pages
    except Exception as exc:
        logger.debug("Fixture pages unavailable: %s", exc)
    return fixture


async def preview_detect(request: ExecutionRequest) -> ExecutionResponse:
    """Run a code detector over real assets and report the findings."""
    started = time.monotonic()
    mode = ExecutionMode.PREVIEW_DETECT
    detector = request.detector or {}
    schema = detector_schema(detector)
    revision = request.revision
    redactor = redactor_for({"secrets": schema.get("secrets") or {}})

    def fail(type_: str, message: str, **extra: Any) -> ExecutionResponse:
        response = ExecutionResponse(
            status=ExecutionStatus.ERROR,
            mode=mode,
            execution_id=request.execution_id,
            revision=revision,
            error=_error(type_, redactor.redact(message)),
            **extra,
        )
        response.duration_ms = int((time.monotonic() - started) * 1000)
        return response

    if str(schema.get("type") or "").upper() != "CODE_DETECTOR":
        return fail("NotACodeDetector", "preview_detect needs a CODE_DETECTOR detector.")

    report = validate_detector_notebook(detector_cells(detector))
    if not report.ok:
        return fail(
            "NotebookContractError", report.violations[0].message, contract=report.to_dict()
        )

    recipe = request.recipe or {}
    if not recipe.get("type"):
        return fail("NoSource", "Pick a source to preview the detector on.")

    count = max(1, min(MAX_PREVIEW_ASSETS, int(request.max_assets or DEFAULT_PREVIEW_ASSETS)))
    sampled = copy.deepcopy(recipe)
    # rows_per_page has a schema minimum of 10; the asset cap below is `count`.
    sampled["sampling"] = {"strategy": "RANDOM", "rows_per_page": max(10, count)}
    # The source must not be handed the detector list: previews judge with one
    # detector, and building the others would load their models for nothing.
    sampled["detectors"] = []

    from ...sources import get_source

    try:
        # The recipe carries the source's id (the API decrypts it into the
        # request); SANDBOX needs it to list the uploaded files.
        source = get_source(sampled, source_id=sampled.get("source_id"))
    except Exception as exc:
        return fail("SourceBuildFailed", f"Could not build the source: {exc}")

    files_dir = os.environ.get(NOTEBOOK_FILES_DIR_ENV)
    if files_dir and Path(files_dir).is_dir():
        os.environ[FILES_DIR_ENV] = files_dir

    log_file = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
    session = CustomDetectorSession(
        key=str(detector.get("key") or "preview"),
        name=str(detector.get("name") or detector.get("key") or "preview"),
        schema=schema,
        source=source,
        stderr=log_file,
    )
    payloads = AssetPayloadServer.shared(source)
    samples: list[dict[str, Any]] = []
    try:
        if request.asset:
            assets: list[Any] = [_stub_asset(request.asset)]
        else:
            assets = []
            async for batch in source.extract_raw():
                for asset in batch:
                    if len(assets) >= count:
                        break
                    assets.append(asset)
                if len(assets) >= count:
                    break

        for asset in assets:
            outcome = await session.detect(asset, request.prior_findings if request.asset else None)
            samples.append(
                {
                    "hash": str(getattr(asset, "hash", "") or ""),
                    "name": str(getattr(asset, "name", "") or ""),
                    "kind": str(getattr(asset, "asset_kind", "") or ""),
                    "status": "ok" if outcome.ok else "error",
                    "error": outcome.error,
                    "durationMs": outcome.elapsed_ms,
                    "findingCount": len(outcome.findings),
                    "findings": [
                        _finding_view(finding) for finding in outcome.findings[:MAX_FINDINGS_SHOWN]
                    ],
                    "warnings": outcome.warnings,
                    "fixture": await _fixture_of(asset, payloads),
                }
            )
            payloads.evict(asset)
    except Exception as exc:
        logger.warning("preview_detect failed: %s", exc)
        session.close()
        return fail(type(exc).__name__, str(exc), assets=redactor.redact_deep(samples))
    finally:
        session.close()
        try:
            source.cleanup()
        except Exception:
            pass

    log_file.seek(0)
    logs = log_file.read(MAX_LOG_BYTES)
    log_file.close()

    failed = sum(1 for sample in samples if sample["status"] == "error")
    if not samples:
        return fail("NoAssets", "The source produced no assets to preview on.")
    response = ExecutionResponse(
        status=ExecutionStatus.SUCCESS if failed < len(samples) else ExecutionStatus.ERROR,
        mode=mode,
        execution_id=request.execution_id,
        revision=revision,
        assets=redactor.redact_deep(samples),
        contract=report.to_dict(),
        result=redactor.redact_deep(
            {
                "sampled": len(samples),
                "failed": failed,
                "findings": sum(sample["findingCount"] for sample in samples),
                "logs": logs,
                "warnings": session.warnings,
            }
        ),
    )
    if failed == len(samples):
        response.error = _error("DetectFailed", redactor.redact(str(samples[0]["error"])))
    response.duration_ms = int((time.monotonic() - started) * 1000)
    return response


__all__ = ["DEFAULT_PREVIEW_ASSETS", "MAX_PREVIEW_ASSETS", "preview_detect"]
