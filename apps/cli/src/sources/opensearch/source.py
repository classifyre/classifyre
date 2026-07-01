"""OpenSearch source — discovers indices and samples documents.

Uses plain REST calls (``requests``) rather than the ``opensearch-py`` client,
since only read-only cluster/index/search endpoints are needed and OpenSearch
keeps these compatible with its Elasticsearch 7.10 fork origin. Shared with
``ElasticsearchSource`` via :mod:`src.sources.search_engine_base` — see that
module for the REST logic.
"""

from __future__ import annotations

from typing import Any

from ...models.generated_input import OpenSearchInput
from ..base import BaseSource
from ..search_engine_base import SearchEngineSourceMixin


class OpenSearchSource(SearchEngineSourceMixin, BaseSource):
    source_type = "opensearch"
    ENGINE_LABEL = "OpenSearch"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = OpenSearchInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._index_lookup: dict[str, str] = {}
