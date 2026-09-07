"""Preview augmentation against real assets: ``preview_augment``.

Unlike ``preview_extract`` — which replays cells in-process — augmentation
needs the **real connector**: the assets it enriches only exist after
extraction. So this flow builds the source from the recipe with sampling
forced to RANDOM and a cap of N (default 5, max 25), takes the first N assets
from ``extract_raw()``, and runs ``setup()`` / ``augment(asset)`` /
``finalize()`` over them.

No sink, no run record, no ingestion — read-only. The answer is an
``ExecutionResponse`` whose ``assets`` carry per-asset **diffs**: metadata
added, tags asserted (and whether each key matches a live Tag detector), links
added, URN change, edges yielded, and warnings.
"""

from __future__ import annotations

import copy
import logging
import time
from typing import Any

from ..notebook.protocol import (
    ExecutionError,
    ExecutionMode,
    ExecutionResponse,
    ExecutionStatus,
)
from ..notebook.redact import Redactor
from .contract import validate_augmentation_notebook
from .session import AugmentationSession, augmentation_config_of

logger = logging.getLogger(__name__)

DEFAULT_PREVIEW_ASSETS = 5
MAX_PREVIEW_ASSETS = 25


def _tag_keys_from_recipe(recipe: dict[str, Any], source: Any) -> set[str]:
    """Keys a live Tag detector would resolve, from this run's recipe.

    The API hydrates runtime TAG detectors into ``recipe.detectors`` before
    dispatch (see cli-runner), so the dispatched recipe is authoritative. A
    detector entry names its tag key via ``custom_detector_key`` (top level or
    under ``config``); a bare ``TAG`` pipeline entry carries ``key``.
    """
    keys: set[str] = set()
    detectors = recipe.get("detectors")
    if not isinstance(detectors, list):
        return keys
    for entry in detectors:
        if not isinstance(entry, dict):
            continue
        if str(entry.get("type") or "").strip().upper() not in {"TAG", "CUSTOM"}:
            continue
        for holder in (entry, entry.get("config")):
            if not isinstance(holder, dict):
                continue
            for field in ("custom_detector_key", "key"):
                value = holder.get(field)
                if isinstance(value, str) and value.strip():
                    keys.add(value.strip())
    if not keys:
        # Fall back to the detectors the pipeline would actually build: exact,
        # at the cost of constructing them.
        try:
            from ..pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(recipe, source, "preview")
            runners = DetectorPipeline._tag_runners(pipeline.detectors)
            keys.update(runners)
        except Exception as exc:
            logger.debug("Could not resolve live Tag detector keys: %s", exc)
    return keys


async def preview_augment(
    recipe: dict[str, Any],
    *,
    max_assets: int = DEFAULT_PREVIEW_ASSETS,
    execution_id: str | None = None,
    revision: int | None = None,
) -> ExecutionResponse:
    """Run augmentation over a bounded sample of real assets and diff each one."""
    started = time.monotonic()
    mode = ExecutionMode.PREVIEW_AUGMENT
    redactor = Redactor.from_recipe(recipe)

    section = augmentation_config_of(recipe)
    cells = (
        section.get("notebook", {}).get("cells")
        if isinstance(section.get("notebook"), dict)
        else None
    )
    if not section.get("enabled", False) or not cells:
        return ExecutionResponse(
            status=ExecutionStatus.ERROR,
            mode=mode,
            execution_id=execution_id,
            revision=revision,
            error=_error(
                "AugmentationNotEnabled",
                "This source has no enabled augmentation notebook to preview.",
            ),
        )

    report = validate_augmentation_notebook(cells)
    if not report.ok:
        violation = report.violations[0]
        return ExecutionResponse(
            status=ExecutionStatus.ERROR,
            mode=mode,
            execution_id=execution_id,
            revision=revision,
            contract=report.to_dict(),
            error=_error("NotebookContractError", violation.message),
        )

    count = max(1, min(MAX_PREVIEW_ASSETS, int(max_assets or DEFAULT_PREVIEW_ASSETS)))

    # The real connector, sampled: RANDOM with a cap, so the preview shows real
    # assets without ingesting anything. No sink is ever built.
    sampled = copy.deepcopy(recipe)
    sampled["sampling"] = {"strategy": "RANDOM", "rows_per_page": count}

    from ..sources import get_source

    try:
        source = get_source(sampled)
    except Exception as exc:
        return ExecutionResponse(
            status=ExecutionStatus.ERROR,
            mode=mode,
            execution_id=execution_id,
            revision=revision,
            error=_error("SourceBuildFailed", f"Could not build the source: {exc}"),
        )

    session = AugmentationSession.from_recipe(recipe, source)
    if session is None:  # pragma: no cover - guarded above, kept for safety
        return ExecutionResponse(
            status=ExecutionStatus.ERROR,
            mode=mode,
            execution_id=execution_id,
            revision=revision,
            error=_error("AugmentationNotEnabled", "Augmentation is not enabled."),
        )
    source.attach_augmentation(session)

    samples: list[dict[str, Any]] = []
    tag_keys = _tag_keys_from_recipe(recipe, source)
    try:
        await session.startup()
        if not session.enabled:
            return ExecutionResponse(
                status=ExecutionStatus.ERROR,
                mode=mode,
                execution_id=execution_id,
                revision=revision,
                error=_error(
                    "AugmentationSetupFailed",
                    session.warnings[-1] if session.warnings else "setup() failed",
                ),
            )

        seen = 0
        async for batch in source.extract_raw():
            for asset in batch:
                if seen >= count:
                    break
                samples.append(await _preview_one(session, source, asset, tag_keys, redactor))
                seen += 1
            if seen >= count:
                break

        finalize_edges = await _finalize_edges(session, source)
        response = ExecutionResponse(
            status=ExecutionStatus.SUCCESS,
            mode=mode,
            execution_id=execution_id,
            revision=revision or session.revision,
            assets=samples,
            result={
                "sampled": len(samples),
                "finalizeEdges": finalize_edges,
                "session": session.summary(),
            },
        )
    except Exception as exc:
        logger.warning("preview_augment failed: %s", exc)
        response = ExecutionResponse(
            status=ExecutionStatus.ERROR,
            mode=mode,
            execution_id=execution_id,
            revision=revision,
            assets=samples,
            error=_error(type(exc).__name__, str(exc)),
        )
    finally:
        session.close()
        try:
            source.cleanup()
        except Exception:
            pass

    response.duration_ms = int((time.monotonic() - started) * 1000)
    return response


async def _preview_one(
    session: AugmentationSession,
    source: Any,
    asset: Any,
    tag_keys: set[str],
    redactor: Redactor,
) -> dict[str, Any]:
    asset_hash = str(getattr(asset, "hash", "") or "")
    before_links = list(getattr(asset, "links", None) or [])
    before_urn = getattr(asset, "urn", None)
    try:
        before_tags = dict(source.asset_tags(asset_hash))
    except Exception:
        before_tags = {}
    warnings_before = len(session.warnings)
    edges_before = session.stats.edges

    await session.augment(asset)

    try:
        after_tags = dict(source.asset_tags(asset_hash))
    except Exception:
        after_tags = {}
    captured_tags = {key: value for key, value in after_tags.items() if key not in before_tags}

    after = getattr(asset, "metadata", None) or {}
    added_metadata = after.get("augmentation") if isinstance(after, dict) else {}
    if not isinstance(added_metadata, dict):
        added_metadata = {}
    after_links = list(getattr(asset, "links", None) or [])

    try:
        drained = source.drain_edges()
    except Exception:
        drained = []

    redacted: dict[str, Any] = redactor.redact_deep(
        {
            "hash": str(getattr(asset, "hash", "") or ""),
            "name": str(getattr(asset, "name", "") or ""),
            "kind": str(getattr(asset, "asset_kind", "") or ""),
            "metadataAdded": dict(added_metadata),
            "tags": {
                key: {"value": value, "matchesTagDetector": key in tag_keys}
                for key, value in captured_tags.items()
            },
            "linksAdded": [link for link in after_links if link not in before_links],
            "urn": {"before": before_urn, "after": getattr(asset, "urn", None)},
            "edges": len(drained),
            "warnings": session.warnings[warnings_before:],
            "augmentedEdges": session.stats.edges - edges_before,
        }
    )
    return redacted


async def _finalize_edges(session: AugmentationSession, source: Any) -> int:
    before = session.stats.edges
    await session.finish()
    try:
        leftover = source.drain_edges()
    except Exception:
        leftover = []
    return (session.stats.edges - before) + len(leftover or [])


def _error(type_: str, message: str) -> ExecutionError:
    return ExecutionError(type=type_, message=message)


__all__ = ["DEFAULT_PREVIEW_ASSETS", "MAX_PREVIEW_ASSETS", "preview_augment"]
