"""Apache Hudi source — inspects Hudi tables via PySpark.

Uses Spark with the Hudi session extensions configured, so schema, partitions,
and the commit timeline come from the engine rather than parsing ``.hoodie``
metadata by hand. Tables are discovered via a Hive Metastore (catalog mode) or as
explicit table locations (``optional.scope.table_paths``).
"""

from __future__ import annotations

import logging
from typing import Any

from ...models.generated_input import HudiInput
from ..delta_lake.source import _storage_conf
from ..dependencies import require_module
from ..spark_base import BaseSparkSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)


class HudiSource(BaseSparkSource):
    source_type = "hudi"
    # Spark 4.1-matched Hudi bundle. Overridable via SPARK_JARS_PACKAGES.
    DEFAULT_JARS_PACKAGES = "org.apache.hudi:hudi-spark4.1-bundle_2.13:1.2.0"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        self.config = HudiInput.model_validate(recipe)
        super().__init__(recipe, source_id, runner_id)
        self.runner_id = runner_id or "local-run"

    def _require_pyspark(self) -> Any:
        return require_module(
            module_name="pyspark.sql",
            source_name="Apache Hudi",
            uv_groups=["hudi"],
            detail="PySpark is required and needs a JDK (Java 21 for Spark 4.x).",
        )

    @property
    def _source_label(self) -> str:
        return "Apache Hudi"

    def _extra_spark_conf(self) -> dict[str, str]:
        conf: dict[str, str] = {
            "spark.serializer": "org.apache.spark.serializer.KryoSerializer",
            "spark.sql.extensions": (
                "org.apache.spark.sql.hudi.HoodieSparkSessionExtension"
            ),
            "spark.sql.catalog.spark_catalog": (
                "org.apache.spark.sql.hudi.catalog.HoodieCatalog"
            ),
        }
        conf.update(_storage_conf(self.config))
        return conf

    def _path_format(self) -> str:
        return "hudi"

    def _iter_tables(self) -> list[TableRef]:
        tables: list[TableRef] = []
        scope = self._scope()
        if scope is not None and (
            getattr(scope, "database", None) or getattr(scope, "include_all_databases", False)
        ):
            tables.extend(super()._iter_tables())
        for path in (getattr(scope, "table_paths", None) or []):
            tables.append(TableRef(database="hudi", schema=None, table=path, object_type="PATH"))
        return tables

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        if table_ref.object_type == "PATH":
            return {}
        fqn = self._table_select_fqn(table_ref)
        meta: dict[str, Any] = {}
        try:
            conn = self._get_cached_connection()
            with conn.cursor() as cursor:
                cursor.execute(f"SHOW TBLPROPERTIES {fqn}")
                rows = cursor.fetchall()
            props = {str(r[0]): str(r[1]) for r in rows if len(r) >= 2}
            table_type = props.get("hoodie.table.type") or props.get("type")
            if table_type:
                meta["table_type"] = table_type
            part = props.get("hoodie.table.partition.fields")
            if part:
                meta["partition_columns"] = [p for p in part.split(",") if p]
        except Exception as exc:
            logger.debug("Hudi properties unavailable for %s: %s", fqn, exc)
        return meta

    def _build_external_url(self, table_ref: TableRef) -> str:
        if table_ref.object_type == "PATH":
            return f"hudi:{table_ref.table}"
        warehouse = self.config.required.warehouse_path.rstrip("/")
        return f"{warehouse}/{table_ref.database}/{table_ref.table}"
