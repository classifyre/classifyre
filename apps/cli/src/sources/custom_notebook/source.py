"""CUSTOM source: extraction logic written by the user as a marimo notebook.

The notebook supplies two functions and nothing else. Everything that makes an
asset an *asset* - a stable hash, a checksum, an asset type the detectors know
how to route, the metadata contract, the sampling window - is derived here, so a
connector author never has to learn any of it, and cannot get it wrong.

The notebook runs in its own process (see ``runner.py``). This class is the
translation layer between that process's JSON frames and the rest of the CLI.
"""

from __future__ import annotations

import logging
import os
import random
import shutil
import tempfile
from collections.abc import AsyncGenerator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from ...models.generated_input import CustomInput
from ...models.generated_single_asset_scan_results import AssetType as OutputAssetType
from ...models.generated_single_asset_scan_results import SingleAssetScanResults
from ...utils.hashing import hash_id
from ..base import BaseSource
from ..dependencies import require_module
from . import runner, store, template

logger = logging.getLogger(__name__)

#: Where the SDK is staged so a notebook's sandbox venv can resolve it by path.
SDK_PATH_ENV = "CLASSIFYRE_SDK_PATH"

#: Which detector-facing asset type each notebook asset kind maps to. `OTHER`
#: is deliberately absent: it resolves to no text content type, so every text
#: detector would be skipped and the asset would silently produce no findings.
_ASSET_TYPE_BY_KIND = {
    "record": OutputAssetType.TXT,
    "page": OutputAssetType.URL,
    "file": OutputAssetType.TXT,
    "table": OutputAssetType.TABLE,
}

_DEFAULT_DISCOVER_TIMEOUT = 600
_DEFAULT_FETCH_TIMEOUT = 120


def resolve_sdk_path() -> str:
    """Locate the authoring SDK for the notebook's sandbox venv."""
    configured = (os.environ.get(SDK_PATH_ENV) or "").strip()
    if configured:
        return configured
    # Development checkout:
    # <root>/apps/cli/src/sources/custom_notebook/source.py -> <root>/packages/py-sdk
    fallback = Path(__file__).resolve().parents[5] / "packages" / "py-sdk"
    return str(fallback)


class CustomNotebookSource(BaseSource):
    """A source whose connector logic is a user-authored notebook."""

    source_type = "custom"
    input_model = CustomInput

    # Deliberately off. The scan cache skips an asset whose checksum is
    # unchanged, and a notebook's checksum is built from whatever metadata it
    # chose to return - which proves nothing about the content behind it.
    SUPPORTS_SCAN_CACHE = False

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self.config = CustomInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"

        self._workspace: Path | None = None
        self._process: runner.NotebookProcess | None = None
        self._ref_by_hash: dict[str, dict[str, Any]] = {}
        self._notebook_revision: int | None = None

    # ── configuration ────────────────────────────────────────────────────

    def _execution(self, key: str, default: Any = None) -> Any:
        optional = getattr(self.config, "optional", None)
        execution = getattr(optional, "execution", None) if optional else None
        value = getattr(execution, key, None) if execution else None
        return default if value is None else value

    @property
    def _discover_timeout(self) -> float:
        return float(self._execution("discover_timeout_seconds", _DEFAULT_DISCOVER_TIMEOUT))

    @property
    def _fetch_timeout(self) -> float:
        return float(self._execution("fetch_timeout_seconds", _DEFAULT_FETCH_TIMEOUT))

    @property
    def _max_assets(self) -> int | None:
        value = self._execution("max_assets")
        return int(value) if value else None

    def _notebook_env(self) -> dict[str, str]:
        """Build the notebook process environment.

        Variables and secrets are handed over as prefixed environment entries;
        the SDK turns them back into ``ctx.variables`` / ``ctx.secrets``. Keys
        are re-checked here rather than trusted from the recipe: the schema
        constrains them, but this is the point where a bad key would become a
        shell-visible identifier, so it is worth refusing rather than mangling.
        """
        env: dict[str, str] = {
            "CLASSIFYRE_NOTEBOOK_MODE": "scan",
            "CLASSIFYRE_NOTEBOOK_PATH": str(self._workspace_path() / template.NOTEBOOK_FILENAME),
            "CLASSIFYRE_NOTEBOOK_WORKSPACE": str(self._workspace_path()),
            "SOURCE_ID": self.source_id or "",
            "RUNNER_ID": self.runner_id or "",
        }

        required = getattr(self.config, "required", None)
        variables = getattr(required, "variables", None) or {}
        masked = getattr(self.config, "masked", None)
        secrets = getattr(masked, "secrets", None) or {}

        for prefix, values in (("CLASSIFYRE_VAR_", variables), ("CLASSIFYRE_SECRET_", secrets)):
            for key, value in dict(values).items():
                if not _is_valid_key(key):
                    raise ValueError(
                        f"{key!r} is not a usable configuration key. Use letters, "
                        "digits and underscores only, not starting with a digit."
                    )
                env[f"{prefix}{key}"] = str(value)

        return env

    # ── notebook process ─────────────────────────────────────────────────

    def _workspace_path(self) -> Path:
        if self._workspace is None:
            self._workspace = Path(
                tempfile.mkdtemp(prefix=f"classifyre-notebook-{self.source_id or 'local'}-")
            )
        return self._workspace

    def _ensure_process(self) -> runner.NotebookProcess:
        if self._process is not None:
            return self._process

        require_module("marimo", "Custom", ["custom-source"])

        notebook = store.load(self.source_id or "")
        self._notebook_revision = notebook.revision
        template.validate(notebook.content)

        workspace = self._workspace_path()
        runner.prepare_workspace(workspace, notebook.content, resolve_sdk_path())
        logger.info("Prepared notebook revision %s in %s", notebook.revision, workspace)

        self._process = runner.NotebookProcess(workspace, self._notebook_env())
        return self._process

    # ── BaseSource contract ──────────────────────────────────────────────

    def test_connection(self) -> dict[str, Any]:
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            process = self._ensure_process()
            process.check(self._fetch_timeout)
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Notebook revision {self._notebook_revision} loaded and check() passed."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = str(exc)
        finally:
            self.cleanup()
        return result

    def generate_hash_id(self, asset_id: str) -> str:
        return hash_id(self.source_type, asset_id)

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        """Phase 1: turn the notebook's discover() into asset stubs."""
        process = self._ensure_process()

        refs = [
            ref
            for ref in process.discover(self._discover_timeout, max_assets=self._max_assets)
            if not self._aborted
        ]
        logger.info("discover() returned %d asset(s)", len(refs))

        refs = self._apply_sampling(refs)
        logger.info("Ingesting %d asset(s) after sampling", len(refs))

        batch: list[SingleAssetScanResults] = []
        for ref in refs:
            if self._aborted:
                break
            batch.append(self._to_asset(ref))
            if len(batch) >= self.BATCH_SIZE:
                yield batch
                batch = []
        if batch:
            yield batch

    def abort(self) -> None:
        logger.info("Aborting custom notebook extraction...")
        super().abort()
        if self._process is not None:
            # The notebook may be blocked in a call that ignores signals; the
            # only reliable way out is to kill it.
            self._process.kill()

    def cleanup(self) -> None:
        if self._process is not None:
            self._process.close()
            self._process = None
        if self._workspace is not None:
            shutil.rmtree(self._workspace, ignore_errors=True)
            self._workspace = None

    # ── sampling ─────────────────────────────────────────────────────────

    def _apply_sampling(self, refs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Choose which of the discovered assets this run ingests.

        Ordering is stabilized by id first so that AUTOMATIC's stored cursor
        keeps pointing at the same place between runs even when the notebook
        returns things in a different order.
        """
        strategy = str(getattr(self.config.sampling, "strategy", "AUTOMATIC")).upper()
        strategy = strategy.rsplit(".", 1)[-1]
        refs = sorted(refs, key=lambda ref: ref.get("id", ""))

        if strategy == "ALL":
            return refs
        if strategy == "AUTOMATIC":
            return self.automatic_window(refs, key="assets")

        size = self.sampling_window_size()
        if strategy == "RANDOM":
            return random.sample(refs, min(size, len(refs)))
        if strategy == "LATEST":
            return sorted(refs, key=lambda ref: ref.get("updated_at") or "", reverse=True)[:size]

        logger.warning("Unknown sampling strategy %r; ingesting everything", strategy)
        return refs

    # ── asset construction ───────────────────────────────────────────────

    def _to_asset(self, ref: dict[str, Any]) -> SingleAssetScanResults:
        asset_hash = self.generate_hash_id(ref["id"])
        # The detector pipeline looks content up by external_url first and only
        # then by hash (see _iter_text_content_pages), so index every alias it
        # may probe with. Indexing only the hash still works, but costs a failed
        # lookup and a misleading warning for every asset in every run.
        for alias in (asset_hash, ref.get("url"), ref["id"]):
            if alias:
                self._ref_by_hash[str(alias)] = ref

        kind = ref.get("kind", "record")
        if kind not in _ASSET_TYPE_BY_KIND:
            logger.warning("Unknown asset kind %r; treating it as a record", kind)
            kind = "record"

        metadata: dict[str, Any] = {
            "resource_id": ref["id"],
            "attributes": ref.get("attributes") or {},
        }
        if kind == "page":
            metadata["title"] = ref.get("name") or ref["id"]
            metadata["links_count"] = len(ref.get("links") or [])

        timestamp = _parse_timestamp(ref.get("updated_at"))

        return SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(
                {"id": ref["id"], "updated_at": ref.get("updated_at"), "metadata": metadata}
            ),
            name=ref.get("name") or ref["id"],
            external_url=self.ensure_location(ref.get("url", ""), fallback=ref["id"]),
            links=[self.generate_hash_id(link) for link in ref.get("links") or []],
            asset_type=_ASSET_TYPE_BY_KIND[kind],
            source_id=self.source_id,
            created_at=timestamp,
            updated_at=timestamp,
            runner_id=self.runner_id,
            **self.metadata_fields(kind, metadata),
        )

    # ── content ──────────────────────────────────────────────────────────

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        content = self._fetch(asset_id)
        if content is None:
            return None

        text = content.get("text")
        if isinstance(text, str) and text:
            return text, text

        rows = content.get("rows")
        if rows:
            rendered = _render_rows(rows)
            return rendered, rendered

        return None

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        content = self._fetch(asset_id)
        if content is None:
            return None
        encoded = content.get("data_b64")
        if not encoded:
            return None
        import base64

        return base64.b64decode(encoded), content.get("mime_type") or "application/octet-stream"

    def _fetch(self, asset_id: str) -> dict[str, Any] | None:
        ref = self._ref_by_hash.get(asset_id)
        if ref is None:
            # Expected: the pipeline probes several candidate identifiers per
            # asset and only one of them is a key here.
            logger.debug("No discovered ref for candidate %s", asset_id)
            return None
        if self._aborted:
            return None
        process = self._ensure_process()
        return process.fetch(ref, self._fetch_timeout)

    def evict_asset_cache(self, asset_hash: str) -> None:
        ref = self._ref_by_hash.pop(asset_hash, None)
        if ref is None:
            return
        # Drop the other aliases pointing at the same ref, or the map grows for
        # the whole run instead of shrinking as assets are processed.
        for alias in (ref.get("url"), ref.get("id")):
            if alias and self._ref_by_hash.get(str(alias)) is ref:
                self._ref_by_hash.pop(str(alias), None)

    def enrich_finding_location(self, finding, asset, text_content) -> None:  # type: ignore[no-untyped-def]
        from ...models.generated_single_asset_scan_results import Location

        if finding.location is None:
            finding.location = Location()
        finding.location.path = asset.external_url


def _is_valid_key(key: str) -> bool:
    return (
        bool(key)
        and (key[0].isalpha() or key[0] == "_")
        and all(char.isalnum() or char == "_" for char in key)
    )


def _parse_timestamp(value: Any) -> datetime:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=UTC)
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)
        except ValueError:
            logger.debug("Unparseable updated_at %r; using now()", value)
    return datetime.now(UTC)


def _render_rows(rows: list[dict[str, Any]]) -> str:
    """Render notebook rows as the tab-separated block the detectors expect."""
    if not rows:
        return ""
    columns: list[str] = []
    for row in rows:
        for key in row:
            if key not in columns:
                columns.append(key)
    lines = ["\t".join(columns)]
    lines += [
        "\t".join("" if row.get(col) is None else str(row.get(col)) for col in columns)
        for row in rows
    ]
    return "\n".join(lines)
