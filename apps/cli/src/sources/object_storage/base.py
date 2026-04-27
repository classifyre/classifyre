from __future__ import annotations

import logging
import random
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any

from ...models.generated_input import SamplingStrategy
from ...models.generated_single_asset_scan_results import (
    AssetType as OutputAssetType,
)
from ...models.generated_single_asset_scan_results import (
    DetectionResult,
    Location,
    SingleAssetScanResults,
)
from ...utils.file_parser import infer_mime_type_from_file_name, iter_file_pages, resolve_mime_type
from ...utils.hashing import hash_id, unhash_id
from ..base import BaseSource
from ..dependencies import require_module

logger = logging.getLogger(__name__)

_TEXT_MIME_TYPES = {
    "application/json",
    "application/xml",
    "text/xml",
    "application/x-ndjson",
    "application/ld+json",
}

_TABULAR_MIME_TYPES = {
    "text/csv",
    "text/tab-separated-values",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/parquet",
    "application/vnd.apache.parquet",
}


_FILE_EXTENSION_HINTS: dict[str, OutputAssetType] = {
    ".png": OutputAssetType.IMAGE,
    ".jpg": OutputAssetType.IMAGE,
    ".jpeg": OutputAssetType.IMAGE,
    ".gif": OutputAssetType.IMAGE,
    ".webp": OutputAssetType.IMAGE,
    ".svg": OutputAssetType.IMAGE,
    ".bmp": OutputAssetType.IMAGE,
    ".ico": OutputAssetType.IMAGE,
    ".mp4": OutputAssetType.VIDEO,
    ".webm": OutputAssetType.VIDEO,
    ".mov": OutputAssetType.VIDEO,
    ".mkv": OutputAssetType.VIDEO,
    ".avi": OutputAssetType.VIDEO,
    ".mp3": OutputAssetType.AUDIO,
    ".wav": OutputAssetType.AUDIO,
    ".aac": OutputAssetType.AUDIO,
    ".ogg": OutputAssetType.AUDIO,
    ".pdf": OutputAssetType.BINARY,
    ".doc": OutputAssetType.BINARY,
    ".docx": OutputAssetType.BINARY,
    ".xls": OutputAssetType.TABLE,
    ".xlsx": OutputAssetType.TABLE,
    ".ppt": OutputAssetType.BINARY,
    ".pptx": OutputAssetType.BINARY,
    ".zip": OutputAssetType.BINARY,
    ".rar": OutputAssetType.BINARY,
    ".7z": OutputAssetType.BINARY,
    ".tar": OutputAssetType.BINARY,
    ".gz": OutputAssetType.BINARY,
    ".parquet": OutputAssetType.TABLE,
    ".json": OutputAssetType.TXT,
    ".xml": OutputAssetType.TXT,
    ".txt": OutputAssetType.TXT,
    ".csv": OutputAssetType.TABLE,
    ".tsv": OutputAssetType.TABLE,
    ".md": OutputAssetType.TXT,
    ".html": OutputAssetType.TXT,
    ".htm": OutputAssetType.TXT,
}


@dataclass(frozen=True)
class ObjectRef:
    key: str
    size: int
    last_modified: datetime
    etag: str | None = None
    content_type_hint: str | None = None


@dataclass(frozen=True)
class ContentSnapshot:
    mime_type: str
    raw_content: str
    text_content: str
    parse_error: str | None
    downloaded_bytes: int
    truncated: bool
    # Raw bytes retained for batchable tabular files so fetch_content_pages() can
    # iterate rows in configurable-sized pages instead of one monolithic text blob.
    raw_bytes: bytes | None = None


class ObjectStorageSourceBase(BaseSource, ABC):
    provider_label = "OBJECT_STORAGE"
    input_model: Any = None

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        if self.input_model is None:
            raise ValueError("input_model must be set in source subclass")
        self.config = self.input_model.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._cached_client: Any | None = None

        self._seen_hashes: set[str] = set()
        self._content_cache: dict[str, tuple[str, str]] = {}
        self._hash_to_uri: dict[str, str] = {}
        self._object_ref_by_hash: dict[str, ObjectRef] = {}
        self._file_processing_deps_checked = False
        # Keyed by both asset_hash and external_url for O(1) lookup from either.
        self._bytes_cache: dict[str, bytes] = {}
        self._mime_cache: dict[str, str] = {}

    def _asset_type_value(self) -> str:
        type_value = self.config.type
        return type_value.value if hasattr(type_value, "value") else str(type_value)

    def _connection_option(self, key: str, default: Any = None) -> Any:
        optional = self.config.optional
        if optional and optional.connection:
            value = getattr(optional.connection, key, None)
            if value is not None:
                return value
        return default

    def _scope_option(self, key: str, default: Any = None) -> Any:
        optional = self.config.optional
        if optional and optional.scope:
            value = getattr(optional.scope, key, None)
            if value is not None:
                return value
        return default

    def _masked_value(self, key: str) -> str | None:
        masked = getattr(self.config, "masked", None)
        if masked is None:
            return None
        value = getattr(masked, key, None)
        if isinstance(value, str) and value.strip():
            return value.strip()
        return None

    def _string_or_none(self, value: Any) -> str | None:
        if value is None:
            return None
        text = str(value).strip()
        return text if text else None

    def _prefix(self) -> str:
        value = self._scope_option("prefix", "")
        return str(value).strip() if value else ""

    def _max_keys_per_page(self) -> int:
        value = self._connection_option("max_keys_per_page", 200)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 200
        return min(max(parsed, 1), 1000)

    def _request_timeout_seconds(self) -> float:
        value = self._connection_option("request_timeout_seconds", 30)
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return 30.0
        return max(parsed, 1.0)

    def _verify_ssl(self) -> bool:
        value = self._connection_option("verify_ssl", True)
        return bool(value) if isinstance(value, bool) else True

    def _max_object_bytes(self) -> int:
        value = self._connection_option("max_object_bytes", 5_242_880)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 5_242_880
        return min(max(parsed, 1_024), 52_428_800)

    def _include_empty_objects(self) -> bool:
        return bool(self._scope_option("include_empty_objects", False))

    def _include_object_metadata(self) -> bool:
        return bool(self._scope_option("include_object_metadata", True))

    def _include_content_preview(self) -> bool:
        return bool(self._scope_option("include_content_preview", True))

    def _normalized_extension_filters(self, key: str) -> list[str]:
        values = self._scope_option(key, [])
        if not isinstance(values, list):
            return []
        normalized: list[str] = []
        for value in values:
            if not isinstance(value, str):
                continue
            cleaned = value.strip().lower()
            if not cleaned:
                continue
            if not cleaned.startswith("."):
                cleaned = f".{cleaned}"
            normalized.append(cleaned)
        return normalized

    def _include_extensions(self) -> list[str]:
        return self._normalized_extension_filters("include_extensions")

    def _exclude_extensions(self) -> list[str]:
        return self._normalized_extension_filters("exclude_extensions")

    def _object_matches_extension_filters(self, key: str) -> bool:
        key_lower = key.lower()
        include_extensions = self._include_extensions()
        exclude_extensions = self._exclude_extensions()

        if include_extensions and not any(key_lower.endswith(ext) for ext in include_extensions):
            return False
        if exclude_extensions and any(key_lower.endswith(ext) for ext in exclude_extensions):
            return False
        return True

    def _parse_datetime(self, value: Any) -> datetime:
        if isinstance(value, datetime):
            if value.tzinfo is None:
                return value.replace(tzinfo=UTC)
            return value.astimezone(UTC)

        if isinstance(value, str) and value.strip():
            normalized = value.strip().replace("Z", "+00:00")
            try:
                parsed = datetime.fromisoformat(normalized)
                if parsed.tzinfo is None:
                    return parsed.replace(tzinfo=UTC)
                return parsed.astimezone(UTC)
            except ValueError:
                pass

        return datetime.now(UTC)

    def _apply_sampling(self, refs: list[ObjectRef]) -> list[ObjectRef]:
        strategy = self.config.sampling.strategy
        if strategy == SamplingStrategy.ALL:
            return refs

        limit = int(self.config.sampling.rows_per_page or 100)

        if strategy == SamplingStrategy.RANDOM:
            if limit >= len(refs):
                return refs
            generator = random.Random(0)
            indexes = sorted(generator.sample(range(len(refs)), k=limit))
            return [refs[index] for index in indexes]

        refs_sorted = sorted(refs, key=lambda ref: ref.last_modified, reverse=True)
        return refs_sorted[:limit]

    def _file_extension(self, key: str) -> str:
        return PurePosixPath(key).suffix.lower()

    def _asset_type_from_mime_or_key(self, mime_type: str | None, key: str) -> OutputAssetType:
        normalized_mime = (mime_type or "").split(";", maxsplit=1)[0].strip().lower()
        extension = self._file_extension(key)

        if normalized_mime in _TABULAR_MIME_TYPES:
            return OutputAssetType.TABLE
        if normalized_mime.startswith("image/"):
            return OutputAssetType.IMAGE
        if normalized_mime.startswith("video/"):
            return OutputAssetType.VIDEO
        if normalized_mime.startswith("audio/"):
            return OutputAssetType.AUDIO
        if normalized_mime.startswith("text/") or normalized_mime in _TEXT_MIME_TYPES:
            return OutputAssetType.TXT

        if extension in _FILE_EXTENSION_HINTS:
            return _FILE_EXTENSION_HINTS[extension]

        if normalized_mime and normalized_mime != "application/octet-stream":
            return OutputAssetType.BINARY

        return OutputAssetType.OTHER

    def _ensure_file_processing_dependencies(self) -> None:
        if self._file_processing_deps_checked:
            return
        self._file_processing_deps_checked = True

        # Object storage sources rely on file-processing extras for MIME detection
        # and document text extraction (PDF/DOCX/XLSX).
        for module_name in ("filetype", "pdfplumber", "docx", "openpyxl"):
            try:
                require_module(
                    module_name=module_name,
                    source_name=f"{self.provider_label} source",
                    uv_groups=["file-processing"],
                    detail=(
                        "Object storage text extraction requires file-processing dependencies."
                    ),
                )
            except Exception as exc:
                logger.debug(
                    "Optional file-processing module %s unavailable for %s: %s",
                    module_name,
                    self.provider_label,
                    exc,
                )

    def _build_snapshot(self, ref: ObjectRef) -> ContentSnapshot:
        if not self._include_content_preview():
            mime = (ref.content_type_hint or "").split(";", maxsplit=1)[0].strip().lower()
            if not mime:
                mime = infer_mime_type_from_file_name(ref.key)
            return ContentSnapshot(
                mime_type=mime or "application/octet-stream",
                raw_content="",
                text_content="",
                parse_error=None,
                downloaded_bytes=0,
                truncated=False,
            )

        try:
            file_bytes, content_type_hint, truncated = self._download_object(ref)
        except Exception as exc:
            logger.warning("Failed to download object %s: %s", ref.key, exc)
            return ContentSnapshot(
                mime_type=(ref.content_type_hint or "application/octet-stream"),
                raw_content="",
                text_content="",
                parse_error=str(exc),
                downloaded_bytes=0,
                truncated=False,
            )

        self._ensure_file_processing_dependencies()
        mime_type = resolve_mime_type(
            file_bytes,
            declared_mime_type=content_type_hint or ref.content_type_hint or "",
            file_name=ref.key,
        )
        normalized_mime = mime_type.split(";", 1)[0].strip().lower()

        # Non-extractable types (images, audio, video, opaque binary) carry no text.
        # Everything else defers extraction to fetch_content_pages() so detectors
        # receive content in configurable-sized pages instead of one monolithic blob.
        is_non_extractable = normalized_mime.startswith(("image/", "audio/", "video/")) or normalized_mime in (
            "application/octet-stream",
            "application/zip",
        )

        return ContentSnapshot(
            mime_type=mime_type,
            raw_content="",
            text_content="",
            parse_error=None,
            downloaded_bytes=len(file_bytes),
            truncated=truncated,
            raw_bytes=None if is_non_extractable else file_bytes,
        )

    def _to_asset(self, ref: ObjectRef) -> SingleAssetScanResults:
        external_url = self._external_url(ref.key)
        asset_hash = self.generate_hash_id(external_url)

        snapshot = self._build_snapshot(ref)
        asset_type = self._asset_type_from_mime_or_key(snapshot.mime_type, ref.key)

        if snapshot.text_content:
            self._content_cache[asset_hash] = (snapshot.raw_content, snapshot.text_content)
        if snapshot.raw_bytes is not None:
            # Store under both keys (asset_hash and external_url) so fetch_content_pages()
            # resolves with O(1) regardless of which candidate_id the pipeline supplies.
            self._bytes_cache[asset_hash] = snapshot.raw_bytes
            self._bytes_cache[external_url] = snapshot.raw_bytes
            self._mime_cache[asset_hash] = snapshot.mime_type
            self._mime_cache[external_url] = snapshot.mime_type

        metadata: dict[str, Any] = {
            "provider": self.provider_label,
            "object_key": ref.key,
            "asset_type": asset_type.value,
        }
        if self._include_object_metadata():
            metadata.update(
                {
                    "size_bytes": ref.size,
                    "etag": ref.etag,
                    "last_modified": ref.last_modified.isoformat(),
                    "mime_type": snapshot.mime_type,
                    "downloaded_bytes": snapshot.downloaded_bytes,
                    "truncated_download": snapshot.truncated,
                    "parse_error": snapshot.parse_error,
                }
            )

        asset = SingleAssetScanResults(
            hash=asset_hash,
            checksum=self.calculate_checksum(metadata),
            name=ref.key.split("/")[-1] or ref.key,
            external_url=external_url,
            links=[],
            asset_type=asset_type,
            source_id=self.source_id,
            created_at=ref.last_modified,
            updated_at=ref.last_modified,
            runner_id=self.runner_id,
        )
        self._hash_to_uri[asset_hash] = external_url
        self._object_ref_by_hash[asset_hash] = ref
        return asset

    def test_connection(self) -> dict[str, Any]:
        result = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            object_refs = self._list_objects()
            result["status"] = "SUCCESS"
            result["message"] = (
                f"Connected to {self.provider_label}. "
                f"Listed {len(object_refs)} object(s) in current scope."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = f"Failed to connect to {self.provider_label}: {exc}"
        return result

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if self._aborted:
            return

        self._seen_hashes = set()
        self._content_cache = {}
        self._hash_to_uri = {}
        self._object_ref_by_hash = {}
        self._bytes_cache = {}
        self._mime_cache = {}

        pipeline = None
        if self.config.detectors and any(detector.enabled for detector in self.config.detectors):
            from ...pipeline.detector_pipeline import DetectorPipeline

            pipeline = DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

        refs = self._list_objects()
        sampled_refs = self._apply_sampling(refs)

        batch: list[SingleAssetScanResults] = []
        for ref in sampled_refs:
            if self._aborted:
                break

            try:
                asset = self._to_asset(ref)
            except Exception as exc:
                logger.warning("Skipping object %s due to transformation error: %s", ref.key, exc)
                continue

            if asset.hash in self._seen_hashes:
                continue

            self._seen_hashes.add(asset.hash)
            batch.append(asset)

            if len(batch) >= self.BATCH_SIZE:
                if pipeline:
                    batch = await pipeline.process(batch)
                if batch:
                    yield batch
                batch = []

        if batch:
            if pipeline:
                batch = await pipeline.process(batch)
            if batch:
                yield batch

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        raw_bytes = self._bytes_cache.get(asset_id)
        mime = self._mime_cache.get(asset_id, "")

        if raw_bytes is not None:
            sampling = self.config.sampling
            batch_size = int(sampling.rows_per_page or 100)
            include_col_names = bool(
                sampling.include_column_names
                if sampling.include_column_names is not None
                else True
            )
            for batch_text in iter_file_pages(raw_bytes, mime, batch_size, include_col_names):
                yield "", batch_text
            return

        result = await self.fetch_content(asset_id)
        if result:
            yield result

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        if asset_id in self._content_cache:
            return self._content_cache[asset_id]

        external_url = self._hash_to_uri.get(asset_id)
        asset_hash = asset_id
        if external_url is None:
            decoded = asset_id
            if "_#_" not in decoded:
                try:
                    decoded = unhash_id(asset_id)
                except Exception:
                    decoded = asset_id
            if "_#_" in decoded:
                _, candidate = decoded.split("_#_", maxsplit=1)
                external_url = candidate
                asset_hash = self.generate_hash_id(candidate)
            else:
                external_url = asset_id
                asset_hash = self.generate_hash_id(asset_id)

        cached = self._content_cache.get(asset_hash)
        if cached is not None:
            return cached

        ref = self._object_ref_by_hash.get(asset_hash)
        if ref is None:
            return None

        snapshot = self._build_snapshot(ref)
        if not snapshot.text_content:
            return None

        content = (snapshot.raw_content, snapshot.text_content)
        self._content_cache[asset_hash] = content
        if external_url:
            self._hash_to_uri[asset_hash] = external_url
        return content

    def generate_hash_id(self, asset_id: str) -> str:
        asset_hash = hash_id(self._asset_type_value(), asset_id)
        self._hash_to_uri[asset_hash] = asset_id
        return asset_hash

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        _ = text_content
        finding.location = Location(path=asset.external_url)

    def abort(self) -> None:
        logger.info("Aborting object storage extraction...")
        super().abort()

    def cleanup(self) -> None:
        client = self._cached_client
        if client is None:
            return
        close_fn = getattr(client, "close", None)
        if callable(close_fn):
            try:
                close_fn()
            except Exception:
                logger.debug("Failed to close object storage client cleanly")

    @abstractmethod
    def _list_objects(self) -> list[ObjectRef]:
        raise NotImplementedError

    @abstractmethod
    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None, bool]:
        raise NotImplementedError

    @abstractmethod
    def _external_url(self, key: str) -> str:
        raise NotImplementedError
