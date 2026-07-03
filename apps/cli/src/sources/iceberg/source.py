"""Apache Iceberg source — JVM-free, backed by PyIceberg + DuckDB.

Tables live in an S3-compatible bucket (same connection shape as the S3
Compatible Storage source). PyIceberg resolves table metadata (schema,
snapshot, partition spec) and the current data file list directly from the
table's ``metadata/`` directory — no catalog service or Spark required.
Rows are sampled through DuckDB over the table's Parquet files.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from ...models.generated_input import IcebergInput
from ..dependencies import require_module
from ..lakehouse_base import BaseLakehouseSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

# Iceberg metadata files: <root>/metadata/00003-<uuid>.metadata.json or v3.metadata.json
_METADATA_KEY_RE = re.compile(r"^(?P<root>.*?)/?metadata/[^/]+\.metadata\.json$")


class IcebergSource(BaseLakehouseSource):
    source_type = "iceberg"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        self.config = IcebergInput.model_validate(recipe)
        super().__init__(recipe, source_id, runner_id)

    @property
    def _source_label(self) -> str:
        return "Apache Iceberg"

    def _uv_groups(self) -> list[str]:
        return ["iceberg"]

    def _require_duckdb(self) -> Any:
        return require_module(
            module_name="duckdb",
            source_name="Apache Iceberg",
            uv_groups=["iceberg"],
            detail="DuckDB is required to sample rows from Iceberg data files.",
        )

    def _require_pyiceberg_table(self) -> Any:
        return require_module(
            module_name="pyiceberg.table",
            source_name="Apache Iceberg",
            uv_groups=["iceberg"],
            detail="PyIceberg is required to read Iceberg table metadata.",
        )

    # ── Discovery: table roots by their metadata/ marker ────────────────

    def _table_root_from_key(self, key: str) -> str | None:
        match = _METADATA_KEY_RE.match(key)
        if not match:
            return None
        return match.group("root") or None

    # ── Table handle: StaticTable from the latest metadata file ─────────

    def _latest_metadata_key(self, root: str) -> str:
        keys = [
            key for key in self._list_keys(f"{root}/metadata/") if key.endswith(".metadata.json")
        ]
        if not keys:
            raise ValueError(f"No Iceberg metadata files found under {root}/metadata/")
        # Metadata file names embed a monotonically increasing version
        # (00001-<uuid>.metadata.json or v1.metadata.json), so the
        # lexicographically greatest key is the current one.
        return max(keys)

    def _pyiceberg_properties(self) -> dict[str, str]:
        properties: dict[str, str] = {}
        endpoint = self._endpoint_url()
        region = self._region_name()
        access_key = self._masked_value("aws_access_key_id")
        secret_key = self._masked_value("aws_secret_access_key")
        session_token = self._masked_value("aws_session_token")
        if endpoint:
            properties["s3.endpoint"] = endpoint
        if region:
            properties["s3.region"] = region
        if access_key and secret_key:
            properties["s3.access-key-id"] = access_key
            properties["s3.secret-access-key"] = secret_key
            if session_token:
                properties["s3.session-token"] = session_token
        return properties

    def _open_table(self, root: str) -> Any:
        table_module = self._require_pyiceberg_table()
        metadata_key = self._latest_metadata_key(root)
        return table_module.StaticTable.from_metadata(
            f"s3://{self._bucket()}/{metadata_key}",
            properties=self._pyiceberg_properties(),
        )

    def _table_data_files(self, handle: Any) -> list[str]:
        return [task.file.file_path for task in handle.scan().plan_files()]

    def _table_columns(self, handle: Any) -> dict[str, str]:
        return {field.name: str(field.field_type) for field in handle.schema().fields}

    # ── Asset metadata extras ────────────────────────────────────────────

    def _estimate_row_count(self, table_ref: TableRef) -> int | None:
        try:
            snapshot = self._handle(table_ref).current_snapshot()
            if snapshot is None:
                return 0
            total = dict(snapshot.summary).get("total-records")
            return int(total) if total is not None else None
        except Exception:
            return None

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        meta: dict[str, Any] = {}
        try:
            handle = self._handle(table_ref)
        except Exception as exc:
            logger.debug("Iceberg metadata unavailable for %s: %s", table_ref.table, exc)
            return meta
        try:
            meta["format_version"] = int(handle.metadata.format_version)
        except Exception:
            pass
        try:
            snapshot = handle.current_snapshot()
            if snapshot is not None:
                meta["snapshot_id"] = str(snapshot.snapshot_id)
                total_files = dict(snapshot.summary).get("total-data-files")
                if total_files is not None:
                    meta["num_files"] = int(total_files)
        except Exception:
            pass
        try:
            meta["partition_spec"] = str(handle.spec())
        except Exception:
            pass
        try:
            meta["sort_order"] = str(handle.sort_order())
        except Exception:
            pass
        return meta
