"""Spark Catalog source — points at a Spark cluster or Spark Connect endpoint.

Given ``sc://host:port`` (Spark Connect) or ``spark://host:port`` (classic
master), this scans the tables registered in the session catalog. Table format
(parquet/delta/iceberg/...) is reported per table via the catalog provider.
"""

from __future__ import annotations

import logging
from typing import Any

from ...models.generated_input import SparkCatalogInput
from ..dependencies import require_module
from ..spark_base import BaseSparkSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)


class SparkCatalogSource(BaseSparkSource):
    source_type = "spark_catalog"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        self.config = SparkCatalogInput.model_validate(recipe)
        super().__init__(recipe, source_id, runner_id)
        self.runner_id = runner_id or "local-run"

    def _require_pyspark(self) -> Any:
        return require_module(
            module_name="pyspark.sql",
            source_name="Spark Catalog",
            uv_groups=["spark-catalog"],
            detail="PySpark is required and needs a JDK (Java 21 for Spark 4.x).",
        )

    @property
    def _source_label(self) -> str:
        return "Spark Catalog"

    def _connect_url(self) -> str:
        return self.config.required.connect_url

    def _spark_remote(self) -> str | None:
        # Users provide the full Spark Connect endpoint plus any options they need as
        # `;key=value` pairs after `/;` — e.g. for Databricks:
        #   sc://host:443/;x-databricks-cluster-id=<id>;use_ssl=true
        # We only inject the token from the masked field so credentials aren't stored
        # in the connect_url in plaintext. Whitespace is stripped defensively.
        url = "".join(self._connect_url().split())
        if not url.startswith("sc://"):
            return None
        token = getattr(self.config.masked, "token", None) if self.config.masked else None
        if not token:
            return url
        token = token.strip()
        if "/;" in url:
            # URL already carries an options segment; add token as another ;key=value.
            return f"{url.rstrip(';')};token={token}"
        return f"{url.rstrip('/')}/;token={token}"

    def _spark_master(self) -> str | None:
        url = self._connect_url()
        return url if not url.startswith("sc://") else None

    def _build_external_url(self, table_ref: TableRef) -> str:
        catalog = self._catalog()
        parts = [p for p in (catalog, table_ref.database, table_ref.table) if p]
        return f"spark://{'.'.join(parts)}"

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        meta: dict[str, Any] = {}
        catalog = self._catalog()
        if catalog:
            meta["catalog"] = catalog
        fqn = self._table_select_fqn(table_ref)
        try:
            conn = self._get_cached_connection()
            with conn.cursor() as cursor:
                cursor.execute(f"DESCRIBE TABLE EXTENDED {fqn}")
                rows = cursor.fetchall()
            for row in rows:
                if len(row) >= 2 and isinstance(row[0], str) and row[0].strip() == "Provider":
                    meta["provider"] = str(row[1]).strip()
                    break
        except Exception as exc:
            logger.debug("Spark provider lookup failed for %s: %s", fqn, exc)
        return meta
