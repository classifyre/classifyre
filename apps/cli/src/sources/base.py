import os
from abc import ABC, abstractmethod
from collections.abc import AsyncGenerator
from typing import Any

from ..models.generated_single_asset_scan_results import DetectionResult, SingleAssetScanResults
from ..utils.hashing import calculate_checksum, normalize_http_url
from ..utils.validation import validate_output
from .recipe_normalizer import normalize_source_recipe


class BaseSource(ABC):
    """
    Abstract base class for all metadata extraction sources.
    """

    # Default batch size for streaming results
    BATCH_SIZE: int = 50
    HAS_SUCCESSFUL_RUN_ENV = "CLASSIFYRE_SOURCE_HAS_SUCCESSFUL_RUN"

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
        self._apply_initial_sampling_override(normalized_recipe)
        recipe.clear()
        recipe.update(normalized_recipe)
        self.recipe = normalized_recipe
        self.source_id = source_id
        self.runner_id = runner_id
        self._aborted = False

    def _apply_initial_sampling_override(self, recipe: dict[str, Any]) -> None:
        sampling = recipe.get("sampling")
        if not isinstance(sampling, dict):
            return

        if sampling.get("fetch_all_until_first_success") is not True:
            return

        has_successful_run = self._read_bool_env(self.HAS_SUCCESSFUL_RUN_ENV)
        if has_successful_run is not False:
            return

        sampling["strategy"] = "ALL"
        sampling.pop("limit", None)

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

    @abstractmethod
    def test_connection(self) -> dict[str, Any]:
        """
        Verify that the connection to the source is working.
        Should return a dictionary conforming to the test-connection schema.
        """
        pass

    @abstractmethod
    async def extract(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        """
        The main extraction logic. Yields batches of extracted items.
        Each batch is a list of SingleAssetScanResults objects.

        This streaming approach allows:
        - Memory-efficient processing of large datasets
        - Real-time progress updates
        - Incremental database commits (avoiding transaction timeouts)

        Yields:
            Batches of SingleAssetScanResults objects
        """
        # Subclasses should implement this as an async generator
        # Example:
        # batch = []
        # for item in items:
        #     batch.append(transform(item))
        #     if len(batch) >= self.BATCH_SIZE:
        #         yield batch
        #         batch = []
        # if batch:
        #     yield batch
        yield []  # Make this a generator for type checking

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
        - Web (WordPress, Sitemap): the page URL
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
