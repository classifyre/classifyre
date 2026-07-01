import base64
import json
import logging
import os
import threading
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator, Generator
from typing import TYPE_CHECKING, Any, TypeVar

from ..models.generated_single_asset_scan_results import DetectionResult, SingleAssetScanResults
from ..outputs.rest import IngestEdge

if TYPE_CHECKING:
    from ..utils.file_parser import ParsedBytes
from ..utils.hashing import calculate_checksum, normalize_http_url
from ..utils.validation import validate_output
from .recipe_normalizer import normalize_source_recipe

logger = logging.getLogger(__name__)

_T = TypeVar("_T")


class BaseSource(ABC):
    """
    Abstract base class for all metadata extraction sources.
    """

    # Stable source identifier, overridden by each concrete source (e.g.
    # "postgresql", "wordpress"). Uppercased it maps to the AssetType enum and
    # the x-asset-metadata catalog key.
    source_type: str = ""

    # Default batch size for streaming asset results
    BATCH_SIZE: int = 50
    HAS_SUCCESSFUL_RUN_ENV = "CLASSIFYRE_SOURCE_HAS_SUCCESSFUL_RUN"
    # The API injects the saved AUTOMATIC sampling cursor here (base64-encoded
    # JSON) before launching the CLI job. The recipe itself cannot carry it
    # because every source schema sets ``additionalProperties: false``.
    SAMPLING_CURSOR_ENV = "CLASSIFYRE_SAMPLING_CURSOR"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ):
        """
        Initialize the source with a validated recipe.

        Args:
            recipe: The source configuration recipe
            source_id: Optional source ID (for API runs)
            runner_id: Optional runner ID (for API runs)
        """
        normalized_recipe = normalize_source_recipe(recipe, recipe.get("type"))
        # Cursor carried over from the previous run (AUTOMATIC strategy). Read
        # before the override hook so subclasses can consult it there if needed.
        self._sampling_cursor: dict[str, Any] = self._load_sampling_cursor()
        self._next_sampling_cursor: dict[str, Any] | None = None
        self._sampling_cursor_lock = threading.Lock()
        self._apply_initial_sampling_override(normalized_recipe)
        recipe.clear()
        recipe.update(normalized_recipe)
        self.recipe = normalized_recipe
        self.source_id = source_id
        self.runner_id = runner_id
        self._aborted = False
        self._discovery_only = False
        self._attachment_name_by_hash: dict[str, str] = {}

    def _apply_initial_sampling_override(self, recipe: dict[str, Any]) -> None:
        pass

    # ── AUTOMATIC sampling cursor ────────────────────────────────────────
    #
    # AUTOMATIC sampling keeps a small, opaque, source-defined cursor in the
    # API between runs. Each run reads the prior cursor (``sampling_cursor``),
    # ingests the next slice of not-yet-seen data, then records the advanced
    # cursor (``set_next_sampling_cursor``). The output sink persists it back to
    # the API on finalize via ``current_sampling_cursor``. When a source has
    # ingested everything it should reset the cursor so the next run wraps
    # around and re-ingests from the start (data is not stale).

    def _load_sampling_cursor(self) -> dict[str, Any]:
        raw = os.environ.get(self.SAMPLING_CURSOR_ENV)
        if not raw:
            return {}
        try:
            decoded = base64.b64decode(raw).decode("utf-8")
            data = json.loads(decoded)
        except Exception as exc:
            logger.warning("Ignoring malformed %s: %s", self.SAMPLING_CURSOR_ENV, exc)
            return {}
        return data if isinstance(data, dict) else {}

    def sampling_cursor(self) -> dict[str, Any]:
        """Return the cursor saved by the previous run (empty on first run)."""
        return self._sampling_cursor

    def set_next_sampling_cursor(self, cursor: dict[str, Any]) -> None:
        """Record the advanced cursor to persist at the end of this run."""
        self._next_sampling_cursor = cursor

    def current_sampling_cursor(self) -> dict[str, Any] | None:
        """Cursor to persist for the next run, or None to leave it unchanged.

        Returns None unless this run advanced the cursor (i.e. AUTOMATIC
        sampling actually ran), so non-AUTOMATIC runs never touch the stored
        cursor.
        """
        return self._next_sampling_cursor

    def sampling_window_size(self, default: int = 100) -> int:
        """The per-run AUTOMATIC slice size (``rows_per_page``)."""
        config = getattr(self, "config", None)
        sampling = getattr(config, "sampling", None) if config is not None else None
        size = getattr(sampling, "rows_per_page", None)
        try:
            return int(size) if size else default
        except (TypeError, ValueError):
            return default

    def _record_cursor_key(self, key: str, value: Any) -> None:
        """Thread-safely set ``key`` in the cursor to persist for the next run."""
        with self._sampling_cursor_lock:
            nxt = self._next_sampling_cursor if isinstance(self._next_sampling_cursor, dict) else {}
            nxt = {**nxt, key: value}
            self._next_sampling_cursor = nxt

    def automatic_offset(self, key: str) -> int:
        """Return the saved offset for a keyed AUTOMATIC DB cursor (0 on first run)."""
        saved = self._sampling_cursor.get(key)
        return saved if isinstance(saved, int) and saved >= 0 else 0

    def record_automatic_offset(self, key: str, *, prev_offset: int, fetched: int) -> None:
        """Advance a keyed offset cursor; wrap to 0 once a page underfills.

        Used by sources that page rows directly from the backing store
        (``skip``/``OFFSET``) rather than materialising a full list.
        """
        size = self.sampling_window_size()
        next_offset = 0 if fetched < size else prev_offset + fetched
        self._record_cursor_key(key, next_offset)

    def automatic_window(self, items: list[_T], *, key: str = "items") -> list[_T]:
        """Return the next AUTOMATIC slice of a stably-ordered in-memory list.

        Non-tabular sources fetch a list of item references, then call this to
        ingest only the next ``rows_per_page`` window. A per-``key`` offset is
        remembered between runs and wraps back to the start once the list has
        been fully covered (data is not stale, so re-ingesting is desired).

        Callers must pass the items in a **stable order** across runs (e.g. by
        id or timestamp) so the cursor stays meaningful.
        """
        total = len(items)
        if total == 0:
            return []

        saved = self._sampling_cursor.get(key)
        offset = saved if isinstance(saved, int) and 0 <= saved < total else 0

        size = self.sampling_window_size()
        window = items[offset : offset + size]

        next_offset = offset + len(window)
        if next_offset >= total:
            next_offset = 0  # wrap around on the next run

        self._record_cursor_key(key, next_offset)

        return window

    @staticmethod
    def _read_bool_env(name: str) -> bool | None:
        raw = os.environ.get(name)
        if raw is None:
            return None
        normalized = raw.strip().lower()
        if normalized in {"1", "true", "yes", "y", "on"}:
            return True
        if normalized in {"0", "false", "no", "n", "off"}:
            return False
        return None

    def set_discovery_only(self, value: bool) -> None:
        self._discovery_only = value

    def evict_asset_cache(self, asset_hash: str) -> None:
        """Free cached content for a processed asset. Override in subclasses."""
        pass

    @abstractmethod
    def test_connection(self) -> dict[str, Any]:
        """
        Verify that the connection to the source is working.
        Should return a dictionary conforming to the test-connection schema.
        """
        pass

    STREAM_DETECTIONS: bool = False

    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        """
        Orchestrates extraction + detection.  Calls ``extract_raw()`` for batches,
        then runs the detector pipeline (if configured) before yielding results.

        Sources should override ``extract_raw()`` instead of this method.
        """
        pipeline = self._build_pipeline()
        async for batch in self.extract_raw():
            if pipeline:
                if self.STREAM_DETECTIONS:
                    async for processed in pipeline.process_stream(batch):
                        yield [processed]
                    continue
                batch = await pipeline.process(batch)  # noqa: PLW2901
            if batch:
                yield batch

    @abstractmethod
    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        """
        The main extraction logic.  Yields batches of raw assets **without**
        running detectors.  The base ``extract()`` wraps this with pipeline
        processing automatically.

        Yields:
            Batches of SingleAssetScanResults objects
        """
        yield []

    def _build_pipeline(self) -> Any:
        config = getattr(self, "config", None)
        detectors = getattr(config, "detectors", None) if config else None
        if not detectors or not any(getattr(d, "enabled", False) for d in detectors):
            return None
        from ..pipeline.detector_pipeline import DetectorPipeline

        return DetectorPipeline.from_recipe(self.recipe, self, self.runner_id)

    @abstractmethod
    def generate_hash_id(self, asset_id: str) -> str:
        """
        Generate a unique stable ID for an asset.
        """
        pass

    def calculate_checksum(self, data: dict[str, Any]) -> str:
        """
        Calculate a stable SHA-256 checksum for a dictionary.
        """
        return calculate_checksum(data)

    def metadata_fields(self, asset_kind: str, data: dict[str, Any]) -> dict[str, Any]:
        """Build the ``asset_kind`` + ``metadata`` kwargs for SingleAssetScanResults.

        Spread into the constructor: ``**self.metadata_fields("page", {...})``.
        ``asset_kind`` is the catalog discriminator (persisted as the asset type
        for display); ``metadata`` is validated against ``x-asset-metadata`` for
        this source/kind — strict (raises) under pytest / ``CLASSIFYRE_STRICT_METADATA``,
        otherwise a warning.
        """
        from .asset_metadata import validate_metadata

        return {
            "asset_kind": asset_kind,
            "metadata": validate_metadata(self.source_type, asset_kind, data),
        }

    @abstractmethod
    def abort(self) -> None:
        """
        Signal the source to stop extraction as soon as possible.
        """
        self._aborted = True

    def cleanup(self) -> None:
        """
        Optional: Clean up resources (close sessions, delete temp files).
        """
        # Default implementation does nothing.

    def get_stats(self) -> dict[str, Any]:
        """
        Optional: Return statistics about the current extraction (total items, success/fail counts).
        """
        return {}

    def discover(self) -> dict[str, Any]:
        """
        Optional: Discover available resources (e.g., list all spaces/projects)
        without performing a full extraction.
        """
        return {}

    def validate_output(self, data: dict[str, Any]) -> None:
        """
        Optional: Use the validation utility to ensure output conforms to schema.
        Can be called during extraction to fail early on bad data.
        """
        source_type = self.recipe.get("type", "").lower()
        validate_output(data, source_type)

    def ensure_location(self, external_url: str, *, fallback: str | None = None) -> str:
        """
        Ensure the asset has a non-empty external URL.
        """
        location = (external_url or "").strip()
        if location:
            return location

        if fallback:
            fallback_value = fallback.strip()
            if fallback_value:
                return fallback_value

        raise ValueError("Asset external_url is required")

    def _attachment_file_name(self, asset_id: str, fallback_url: str) -> str:
        """Return the stored file name for an attachment, or fallback_url if not recorded."""
        stored = self._attachment_name_by_hash.get(asset_id)
        if isinstance(stored, str) and stored.strip():
            return stored.strip()
        return fallback_url

    def ocr_enabled(self) -> bool:
        """Return whether sampling-level OCR is enabled for this source."""
        config = getattr(self, "config", None)
        sampling = getattr(config, "sampling", None) if config is not None else None
        return bool(getattr(sampling, "enable_ocr", False))

    def transcription_enabled(self) -> bool:
        """Return whether sampling-level audio/video transcription is enabled."""
        config = getattr(self, "config", None)
        sampling = getattr(config, "sampling", None) if config is not None else None
        return bool(getattr(sampling, "enable_transcription", False))

    def parse_asset_bytes(
        self,
        file_bytes: bytes,
        *,
        declared_mime_type: str | None = None,
        file_name: str = "",
    ) -> "ParsedBytes":
        from ..utils.file_parser import parse_bytes

        return parse_bytes(
            file_bytes,
            declared_mime_type=declared_mime_type,
            file_name=file_name,
            enable_ocr=self.ocr_enabled(),
            enable_transcription=self.transcription_enabled(),
        )

    def iter_asset_pages(
        self,
        file_bytes: bytes,
        mime_type: str,
        batch_size: int = 100,
        include_column_names: bool = True,
        *,
        file_name: str = "",
    ) -> Generator[str, None, None]:
        from ..utils.file_parser import iter_file_pages

        return iter_file_pages(
            file_bytes,
            mime_type,
            batch_size,
            include_column_names,
            file_name=file_name,
            enable_ocr=self.ocr_enabled(),
            enable_transcription=self.transcription_enabled(),
        )

    async def fetch_content_bytes(self, asset_id: str) -> tuple[bytes, str] | None:
        """
        Fetch raw bytes and MIME type for an asset (for binary/image detectors).

        Returns (raw_bytes, mime_type) or None if binary content is not available.
        Sources that store raw file bytes should override this method.
        """
        return None

    async def fetch_content_pages(self, asset_id: str) -> AsyncGenerator[tuple[str, str], None]:
        """
        Async generator yielding (raw_content, text_content) pages for an asset.

        Default: yields a single result from fetch_content.
        Tabular sources override this to stream pages for ALL strategy.
        """
        result = await self.fetch_content(asset_id)
        if result:
            yield result

    async def fetch_content(self, asset_id: str) -> tuple[str, str] | None:
        """
        Fetch full content for an asset (for detector scanning).

        This method should be implemented by sources that support content fetching.
        It retrieves the full content of an asset given its identifier.

        Args:
            asset_id: Asset identifier (page_id, post_id, document_id, etc.)

        Returns:
            Tuple of (raw_content, text_content) where:
            - raw_content: Original HTML/markup content
            - text_content: Plain text extracted from content
            Returns None if content fetching is not supported or fails.

        Note:
            Default implementation returns None. Sources that support detector
            integration should override this method.
        """
        return None

    def enrich_finding_location(
        self,
        finding: DetectionResult,
        asset: SingleAssetScanResults,
        text_content: str,
    ) -> None:
        """
        Set a human-readable path on finding.location so users can find the source.

        Override per source type:
        - Tabular (PostgreSQL, MySQL): "schema.table, row N"
        - Web (WordPress): the page URL
        - Slack: permalink or "channel / message_ts"
        """
        pass

    def resolve_link_for_detection(self, link: str) -> str | None:
        """
        Resolve a stored asset link into a concrete HTTP(S) URL for link-based detectors.

        Sources that store non-URL link identifiers (for example, hashed IDs) can override
        this and map those identifiers back to their original URLs.
        """
        return normalize_http_url(link)

    async def collect_relationships(self) -> list[IngestEdge]:
        """Return source-derived relationship edges for the investigation graph.

        Connectors override this to emit typed edges (READS, ATTACHED_TO,
        SENT_TO, OWNS, ACCESSED, etc.) discovered during extraction. The caller
        (main.py) will forward these to ``RestOutputSink.emit_edges()``.

        Default: no relationships (empty list).
        """
        return []
