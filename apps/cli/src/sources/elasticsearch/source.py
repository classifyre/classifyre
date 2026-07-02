"""Elasticsearch source — discovers indices and samples documents.

Uses plain REST calls (``requests``) rather than the ``elasticsearch-py``
client, since only read-only cluster/index/search endpoints are needed and
those are stable across Elasticsearch versions. Shared with ``OpenSearchSource``
via :mod:`src.sources.search_engine_base` — see that module for the REST logic.
"""

from __future__ import annotations

from typing import Any

from ...models.generated_input import ElasticsearchInput
from ..base import BaseSource
from ..search_engine_base import SearchEngineSourceMixin


class ElasticsearchSource(SearchEngineSourceMixin, BaseSource):
    source_type = "elasticsearch"
    ENGINE_LABEL = "Elasticsearch"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = ElasticsearchInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._index_lookup: dict[str, str] = {}
