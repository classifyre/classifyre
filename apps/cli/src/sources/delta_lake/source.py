"""Delta Lake source — inspects Delta tables via PySpark.

Rather than parsing ``_delta_log`` directly, this reads through Spark with the
Delta extensions configured, so schema, partitions, history, and file statistics
come from the engine. Tables are discovered either through a Hive Metastore
(catalog mode) or as explicit table locations (``optional.scope.table_paths``).
"""

from __future__ import annotations

import logging
from typing import Any

from ...models.generated_input import DeltaLakeInput
from ..dependencies import require_module
from ..spark_base import BaseSparkSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)


class DeltaLakeSource(BaseSparkSource):
    source_type = "delta_lake"
    # Spark 4.1-matched Delta runtime. Overridable via SPARK_JARS_PACKAGES.
    DEFAULT_JARS_PACKAGES = "io.delta:delta-spark_2.13:4.1.0"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        self.config = DeltaLakeInput.model_validate(recipe)
        super().__init__(recipe, source_id, runner_id)
        self.runner_id = runner_id or "local-run"

    def _require_pyspark(self) -> Any:
        return require_module(
            module_name="pyspark.sql",
            source_name="Delta Lake",
            uv_groups=["delta-lake"],
            detail="PySpark is required and needs a JDK (Java 21 for Spark 4.x).",
        )

    # ── Identity ─────────────────────────────────────────────────────────

    @property
    def _source_label(self) -> str:
        return "Delta Lake"

    # ── Spark config ─────────────────────────────────────────────────────

    def _extra_spark_conf(self) -> dict[str, str]:
        conf: dict[str, str] = {
            "spark.sql.extensions": "io.delta.sql.DeltaSparkSessionExtension",
            "spark.sql.catalog.spark_catalog": ("org.apache.spark.sql.delta.catalog.DeltaCatalog"),
        }
        conf.update(_storage_conf(self.config))
        return conf

    def _path_format(self) -> str:
        return "delta"

    # ── Discovery: combine catalog tables + explicit table paths ─────────

    def _iter_tables(self) -> list[TableRef]:
        tables: list[TableRef] = []
        scope = self._scope()
        if scope is not None and (
            getattr(scope, "database", None) or getattr(scope, "include_all_databases", False)
        ):
            tables.extend(super()._iter_tables())
        for path in getattr(scope, "table_paths", None) or []:
            tables.append(TableRef(database="delta", schema=None, table=path, object_type="PATH"))
        return tables

    # ── Asset metadata extras ────────────────────────────────────────────

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        # DESCRIBE DETAIL/HISTORY need a Delta table reference; for path-mode use
        # the delta-by-path form rather than the registered temp view.
        if table_ref.object_type == "PATH":
            target = f"delta.`{table_ref.table}`"
        else:
            target = self._table_select_fqn(table_ref)
        meta: dict[str, Any] = {}
        try:
            conn = self._get_cached_connection()
            with conn.cursor() as cursor:
                cursor.execute(f"DESCRIBE DETAIL {target}")
                detail_cols = [d[0] for d in cursor.description] if cursor.description else []
                detail_row = cursor.fetchone()
            if detail_row:
                detail = dict(zip(detail_cols, detail_row, strict=False))
                if detail.get("numFiles") is not None:
                    meta["num_files"] = int(detail["numFiles"])
                part_cols = detail.get("partitionColumns")
                if isinstance(part_cols, (list, tuple)):
                    meta["partition_columns"] = [str(c) for c in part_cols]
                if detail.get("minReaderVersion") is not None:
                    meta["format_version"] = int(detail["minReaderVersion"])
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM (DESCRIBE HISTORY {target})")
                hist = cursor.fetchone()
            if hist and hist[0] is not None:
                meta["history_length"] = int(hist[0])
        except Exception as exc:
            logger.debug("Delta detail/history unavailable for %s: %s", target, exc)
        return meta

    # ── External URL ─────────────────────────────────────────────────────

    def _build_external_url(self, table_ref: TableRef) -> str:
        if table_ref.object_type == "PATH":
            return f"delta:{table_ref.table}"
        warehouse = self.config.required.warehouse_path.rstrip("/")
        return f"{warehouse}/{table_ref.database}/{table_ref.table}"


def _storage_conf(config: Any) -> dict[str, str]:
    """Build Hadoop/S3 + metastore Spark config from masked creds + connection."""
    conf: dict[str, str] = {}
    masked = getattr(config, "masked", None)
    if masked is not None:
        if getattr(masked, "s3_access_key_id", None):
            conf["spark.hadoop.fs.s3a.access.key"] = masked.s3_access_key_id
        if getattr(masked, "s3_secret_access_key", None):
            conf["spark.hadoop.fs.s3a.secret.key"] = masked.s3_secret_access_key
        if getattr(masked, "s3_session_token", None):
            conf["spark.hadoop.fs.s3a.session.token"] = masked.s3_session_token
    optional = getattr(config, "optional", None)
    connection = getattr(optional, "connection", None) if optional is not None else None
    if connection is not None:
        if getattr(connection, "endpoint_url", None):
            conf["spark.hadoop.fs.s3a.endpoint"] = connection.endpoint_url
        if getattr(connection, "metastore_uri", None):
            conf["spark.hadoop.hive.metastore.uris"] = connection.metastore_uri
            conf["spark.sql.catalogImplementation"] = "hive"
    return conf
