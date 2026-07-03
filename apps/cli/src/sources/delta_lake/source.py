"""Delta Lake source — JVM-free, backed by delta-rs (``deltalake``) + DuckDB.

Tables live in an S3-compatible bucket (same connection shape as the S3
Compatible Storage source). The ``deltalake`` package reads ``_delta_log``
directly for schema, version, and data file lists — no Spark required.
Rows are sampled through DuckDB over the table's Parquet files.
"""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import urlsplit

from ...models.generated_input import DeltaLakeInput
from ..dependencies import require_module
from ..lakehouse_base import BaseLakehouseSource
from ..tabular_utils import TableRef

logger = logging.getLogger(__name__)

_DELTA_LOG_MARKER = "/_delta_log/"


class DeltaLakeSource(BaseLakehouseSource):
    source_type = "delta_lake"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        self.config = DeltaLakeInput.model_validate(recipe)
        super().__init__(recipe, source_id, runner_id)

    @property
    def _source_label(self) -> str:
        return "Delta Lake"

    def _uv_groups(self) -> list[str]:
        return ["delta-lake"]

    def _require_duckdb(self) -> Any:
        return require_module(
            module_name="duckdb",
            source_name="Delta Lake",
            uv_groups=["delta-lake"],
            detail="DuckDB is required to sample rows from Delta data files.",
        )

    def _require_deltalake(self) -> Any:
        return require_module(
            module_name="deltalake",
            source_name="Delta Lake",
            uv_groups=["delta-lake"],
            detail="The deltalake (delta-rs) package is required to read Delta tables.",
        )

    # ── Discovery: table roots by their _delta_log/ marker ──────────────

    def _table_root_from_key(self, key: str) -> str | None:
        marker = key.find(_DELTA_LOG_MARKER)
        if marker < 0:
            return None
        return key[:marker] or None

    # ── Table handle ─────────────────────────────────────────────────────

    def _storage_options(self) -> dict[str, str]:
        options: dict[str, str] = {}
        access_key = self._masked_value("aws_access_key_id")
        secret_key = self._masked_value("aws_secret_access_key")
        session_token = self._masked_value("aws_session_token")
        region = self._region_name()
        endpoint = self._endpoint_url()
        if access_key and secret_key:
            options["AWS_ACCESS_KEY_ID"] = access_key
            options["AWS_SECRET_ACCESS_KEY"] = secret_key
            if session_token:
                options["AWS_SESSION_TOKEN"] = session_token
        if region:
            options["AWS_REGION"] = region
        if endpoint:
            options["AWS_ENDPOINT_URL"] = endpoint
            # Custom endpoints (MinIO/R2/B2/Garage) generally require path-style
            # addressing; plain HTTP is only ever used for local test setups.
            options["AWS_VIRTUAL_HOSTED_STYLE_REQUEST"] = "false"
            if urlsplit(endpoint).scheme == "http":
                options["AWS_ALLOW_HTTP"] = "true"
        return options

    def _open_table(self, root: str) -> Any:
        deltalake = self._require_deltalake()
        return deltalake.DeltaTable(
            self._table_uri(root),
            storage_options=self._storage_options(),
        )

    def _table_data_files(self, handle: Any) -> list[str]:
        return [str(uri) for uri in handle.file_uris()]

    def _table_columns(self, handle: Any) -> dict[str, str]:
        columns: dict[str, str] = {}
        for field in handle.schema().fields:
            field_type = getattr(field.type, "type", None)
            columns[field.name] = str(field_type) if field_type is not None else str(field.type)
        return columns

    # ── Asset metadata extras ────────────────────────────────────────────

    def _estimate_row_count(self, table_ref: TableRef) -> int | None:
        try:
            actions = self._handle(table_ref).get_add_actions(flatten=True)
            column = actions.column("num_records")
            total = sum(v.as_py() or 0 for v in column)
            return int(total)
        except Exception:
            return None

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        meta: dict[str, Any] = {}
        try:
            handle = self._handle(table_ref)
        except Exception as exc:
            logger.debug("Delta metadata unavailable for %s: %s", table_ref.table, exc)
            return meta
        try:
            meta["num_files"] = len(handle.file_uris())
        except Exception:
            pass
        try:
            partition_columns = handle.metadata().partition_columns
            if partition_columns:
                meta["partition_columns"] = [str(c) for c in partition_columns]
        except Exception:
            pass
        try:
            meta["format_version"] = int(handle.protocol().min_reader_version)
        except Exception:
            pass
        try:
            meta["history_length"] = len(handle.history())
        except Exception:
            pass
        return meta
