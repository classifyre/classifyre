"""Apache Iceberg source — inspects Iceberg tables via PySpark.

Since the lakehouse sources already require a JVM, Iceberg is read through Spark
with the iceberg-spark-runtime extensions and a configured catalog (REST / Hive /
Glue / JDBC), rather than a separate pure-Python path. Schema, partitions, and
snapshot info come from the engine and Iceberg's metadata tables.
"""

from __future__ import annotations

import logging
from typing import Any

from ...models.generated_input import IcebergInput
from ..dependencies import require_module
from ..spark_base import BaseSparkSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)


class IcebergSource(BaseSparkSource):
    source_type = "iceberg"
    # Spark catalog name the Iceberg catalog is mounted under.
    CATALOG = "iceberg_catalog"
    # Spark 4.1-matched iceberg-spark-runtime + AWS bundle (Glue/S3).
    # Overridable via SPARK_JARS_PACKAGES.
    DEFAULT_JARS_PACKAGES = (
        "org.apache.iceberg:iceberg-spark-runtime-4.1_2.13:1.11.0,"
        "org.apache.iceberg:iceberg-aws-bundle:1.11.0"
    )

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        self.config = IcebergInput.model_validate(recipe)
        super().__init__(recipe, source_id, runner_id)
        self.runner_id = runner_id or "local-run"

    def _require_pyspark(self) -> Any:
        return require_module(
            module_name="pyspark.sql",
            source_name="Apache Iceberg",
            uv_groups=["iceberg"],
            detail="PySpark is required and needs a JDK (Java 21 for Spark 4.x).",
        )

    @property
    def _source_label(self) -> str:
        return "Apache Iceberg"

    # ── Spark / catalog config ───────────────────────────────────────────

    def _extra_spark_conf(self) -> dict[str, str]:
        name = self.CATALOG
        required = self.config.required
        ctype = required.catalog_type.value  # REST/HIVE/GLUE/SQL
        conf: dict[str, str] = {
            "spark.sql.extensions": (
                "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions"
            ),
            f"spark.sql.catalog.{name}": "org.apache.iceberg.spark.SparkCatalog",
            f"spark.sql.catalog.{name}.warehouse": required.warehouse,
        }
        if ctype == "REST":
            conf[f"spark.sql.catalog.{name}.type"] = "rest"
            if required.catalog_uri:
                conf[f"spark.sql.catalog.{name}.uri"] = required.catalog_uri
            token = getattr(self.config.masked, "token", None) if self.config.masked else None
            if token:
                conf[f"spark.sql.catalog.{name}.token"] = token
        elif ctype == "HIVE":
            conf[f"spark.sql.catalog.{name}.type"] = "hive"
            if required.catalog_uri:
                conf[f"spark.sql.catalog.{name}.uri"] = required.catalog_uri
        elif ctype == "GLUE":
            conf[f"spark.sql.catalog.{name}.catalog-impl"] = (
                "org.apache.iceberg.aws.glue.GlueCatalog"
            )
            conf[f"spark.sql.catalog.{name}.io-impl"] = "org.apache.iceberg.aws.s3.S3FileIO"
        elif ctype == "SQL":
            conf[f"spark.sql.catalog.{name}.catalog-impl"] = (
                "org.apache.iceberg.jdbc.JdbcCatalog"
            )
            if required.catalog_uri:
                conf[f"spark.sql.catalog.{name}.uri"] = required.catalog_uri

        masked = self.config.masked
        if masked is not None:
            if getattr(masked, "aws_access_key_id", None):
                conf[f"spark.sql.catalog.{name}.s3.access-key-id"] = masked.aws_access_key_id
            if getattr(masked, "aws_secret_access_key", None):
                conf[f"spark.sql.catalog.{name}.s3.secret-access-key"] = (
                    masked.aws_secret_access_key
                )
        return conf

    # ── Discovery: namespaces in the Iceberg catalog ─────────────────────

    def _catalog(self) -> str | None:
        return self.CATALOG

    def _resolve_databases(self) -> list[str]:
        scope = self._scope()
        if scope is not None and getattr(scope, "namespace", None) and not getattr(
            scope, "include_all_namespaces", False
        ):
            return [scope.namespace]
        if scope is not None and getattr(scope, "include_all_namespaces", False):
            conn = self._connect()
            with conn.cursor() as cursor:
                cursor.execute(f"SHOW NAMESPACES IN `{self.CATALOG}`")
                rows = cursor.fetchall()
            return [row[-1] for row in rows if row and isinstance(row[-1], str)]
        if scope is not None and getattr(scope, "namespace", None):
            return [scope.namespace]
        raise ValueError(
            "Iceberg requires optional.scope.namespace or include_all_namespaces=true"
        )

    # ── Asset metadata extras (best-effort via Iceberg metadata tables) ──

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        fqn = self._table_select_fqn(table_ref)
        meta: dict[str, Any] = {}
        try:
            conn = self._get_cached_connection()
            with conn.cursor() as cursor:
                cursor.execute(
                    f"SELECT snapshot_id FROM {fqn}.snapshots ORDER BY committed_at DESC LIMIT 1"
                )
                row = cursor.fetchone()
            if row and row[0] is not None:
                meta["snapshot_id"] = str(row[0])
        except Exception as exc:
            logger.debug("Iceberg snapshot lookup failed for %s: %s", fqn, exc)
        try:
            conn = self._get_cached_connection()
            with conn.cursor() as cursor:
                cursor.execute(f"SELECT COUNT(*) FROM {fqn}.files")
                row = cursor.fetchone()
            if row and row[0] is not None:
                meta["num_files"] = int(row[0])
        except Exception as exc:
            logger.debug("Iceberg files count failed for %s: %s", fqn, exc)
        return meta

    def _build_external_url(self, table_ref: TableRef) -> str:
        return f"iceberg://{table_ref.database}.{table_ref.table}"
