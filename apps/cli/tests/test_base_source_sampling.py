from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Any

from src.models.generated_single_asset_scan_results import SingleAssetScanResults
from src.sources.base import BaseSource


class _DummySource(BaseSource):
    def test_connection(self) -> dict[str, Any]:
        return {"status": "SUCCESS"}

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        if False:
            yield []

    def generate_hash_id(self, asset_id: str) -> str:
        return asset_id

    def abort(self) -> None:
        self._aborted = True


def _recipe() -> dict[str, Any]:
    return {
        "type": "POSTGRESQL",
        "required": {"host": "db.local", "port": 5432},
        "sampling": {
            "strategy": "LATEST",
            "rows_per_page": 10,
        },
    }


def test_sampling_keeps_configured_strategy() -> None:
    source = _DummySource(_recipe())

    assert source.recipe["sampling"]["strategy"] == "LATEST"
    assert source.recipe["sampling"]["rows_per_page"] == 10


def test_sampling_all_strategy_preserved() -> None:
    recipe = _recipe()
    recipe["sampling"]["strategy"] = "ALL"
    source = _DummySource(recipe)

    assert source.recipe["sampling"]["strategy"] == "ALL"
