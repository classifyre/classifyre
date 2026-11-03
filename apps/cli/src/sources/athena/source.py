"""Amazon Athena over the AWS Glue Data Catalog.

The Glue catalog is the table list: databases, tables, their columns, their
storage location and their format — Iceberg (``table_type=ICEBERG``), Delta
(``spark.sql.sources.provider=delta``), Hudi (its input format) or plain files.
Rows are read with Athena SQL, which reads each format through its own reader.

Athena bills by bytes scanned, and a ``LIMIT`` does not reduce what a scan of a
non-partitioned table reads. Every page is one query, so ``rows_per_page`` is
also the knob for cost; RANDOM sampling (``ORDER BY random()``) reads the whole
table once per run.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any

from ...models.generated_input import AthenaInput, SamplingConfig
from ...utils.sql_lineage import upstream_tables_from_sql
from ..dependencies import require_module
from ..inline_paging import InlinePagingMixin
from ..tabular_base import BaseTabularSource
from ..tabular_utils import TableRef, ViewLineage

logger = logging.getLogger(__name__)

_PRESTO_VIEW_RE = re.compile(r"/\* Presto View: (?P<payload>[A-Za-z0-9+/=]+) \*/")


def _quote(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def glue_table_format(table: dict[str, Any]) -> str:
    """The storage format a Glue table entry declares."""
    params = {str(k).lower(): str(v).lower() for k, v in (table.get("Parameters") or {}).items()}
    if table.get("TableType") == "VIRTUAL_VIEW":
        return "view"
    if params.get("table_type") == "iceberg":
        return "iceberg"
    if params.get("spark.sql.sources.provider") == "delta" or params.get("table_type") == "delta":
        return "delta"
    input_format = str((table.get("StorageDescriptor") or {}).get("InputFormat") or "").lower()
    if "hudi" in input_format:
        return "hudi"
    return "external" if table.get("TableType") == "EXTERNAL_TABLE" else "native"


class AthenaSource(InlinePagingMixin, BaseTabularSource):
    source_type = "athena"

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id, runner_id)
        self.config = AthenaInput.model_validate(recipe)
        self.runner_id = runner_id or "local-run"
        self._glue: Any = None
        self._glue_tables: dict[tuple[str, ...], dict[str, Any]] = {}

    @property
    def _source_label(self) -> str:
        return "Amazon Athena"

    def _asset_type_value(self) -> str:
        return str(getattr(self.config.type, "value", self.config.type))

    def _sampling(self) -> SamplingConfig:
        return self.config.sampling

    def _option(self, section: str, name: str, default: Any = None) -> Any:
        block = getattr(self.config.optional, section, None) if self.config.optional else None
        value = getattr(block, name, None) if block is not None else None
        return default if value is None else getattr(value, "value", value)

    def _names(self, name: str) -> set[str]:
        return {
            str(v).strip().lower() for v in (self._option("scope", name) or []) if str(v).strip()
        }

    def _aws_kwargs(self) -> dict[str, Any]:
        masked = self.config.masked
        kwargs: dict[str, Any] = {"region_name": self.config.required.region}
        if masked and masked.aws_access_key_id and masked.aws_secret_access_key:
            kwargs["aws_access_key_id"] = masked.aws_access_key_id
            kwargs["aws_secret_access_key"] = masked.aws_secret_access_key
            if masked.aws_session_token:
                kwargs["aws_session_token"] = masked.aws_session_token
        return kwargs

    def _catalog(self) -> str:
        return str(self._option("connection", "catalog_name", "AwsDataCatalog"))

    # ── Connection ───────────────────────────────────────────────────────

    def _connect(self, database: str | None = None) -> Any:
        pyathena = require_module(
            module_name="pyathena", source_name="Amazon Athena", uv_groups=["athena"]
        )
        return pyathena.connect(
            s3_staging_dir=self.config.required.s3_staging_dir,
            work_group=self._option("connection", "work_group", "primary"),
            catalog_name=self._catalog(),
            schema_name=database or "default",
            **self._aws_kwargs(),
        )

    def _glue_client(self) -> Any:
        if self._glue is None:
            boto3 = require_module(
                module_name="boto3", source_name="Amazon Athena", uv_groups=["athena"]
            )
            self._glue = boto3.client("glue", **self._aws_kwargs())
        return self._glue

    # ── Discovery (Glue) ─────────────────────────────────────────────────

    def _resolve_databases(self) -> list[str]:
        include, exclude = self._names("include_databases"), self._names("exclude_databases")
        names: list[str] = []
        for page in self._glue_client().get_paginator("get_databases").paginate():
            for database in page.get("DatabaseList", []):
                name = str(database["Name"])
                if name.lower() in exclude or (include and name.lower() not in include):
                    continue
                names.append(name)
        return names

    def _list_tables_for_database(self, database: str) -> list[TableRef]:
        include_tables = self._option("scope", "include_tables", True) is not False
        include_views = self._option("scope", "include_views", True) is not False
        objects = self._names("include_objects")
        limit = self._option("scope", "table_limit")
        tables: list[TableRef] = []
        for page in self._glue_client().get_paginator("get_tables").paginate(DatabaseName=database):
            for entry in page.get("TableList", []):
                name = str(entry["Name"])
                is_view = entry.get("TableType") == "VIRTUAL_VIEW"
                if (is_view and not include_views) or (not is_view and not include_tables):
                    continue
                if objects and f"{database.lower()}.{name.lower()}" not in objects:
                    continue
                ref = TableRef(
                    database=database,
                    schema=None,
                    table=name,
                    object_type="VIEW" if is_view else "TABLE",
                )
                self._glue_tables[ref.table_key] = entry
                tables.append(ref)
                if limit and len(tables) >= int(limit):
                    return tables
        return tables

    def _available_column_types(self, table_ref: TableRef) -> dict[str, str]:
        entry = self._glue_tables.get(table_ref.table_key)
        if entry is None:
            entry = self._glue_client().get_table(
                DatabaseName=table_ref.database, Name=table_ref.table
            )["Table"]
        descriptor = entry.get("StorageDescriptor") or {}
        columns = list(descriptor.get("Columns") or []) + list(entry.get("PartitionKeys") or [])
        return {str(c["Name"]): str(c.get("Type", "")) for c in columns}

    def _available_columns(self, table_ref: TableRef) -> list[str]:
        return list(self._available_column_types(table_ref))

    def _query_primary_key_columns(self, table_ref: TableRef) -> list[str]:
        return []

    # ── Dialect ──────────────────────────────────────────────────────────

    def _quote_identifier(self, identifier: str) -> str:
        return _quote(identifier)

    def _table_select_fqn(self, table_ref: TableRef) -> str:
        return f"{_quote(table_ref.database)}.{_quote(table_ref.table)}"

    def _random_order_expr(self) -> str:
        return "random()"

    # ── Lineage ──────────────────────────────────────────────────────────

    def _collect_view_lineage(self, tables: list[TableRef]) -> list[ViewLineage]:
        if self._option("extraction", "include_view_lineage", True) is False:
            return []
        scoped = {t.table_key for t in tables}
        results: list[ViewLineage] = []
        for view in tables:
            entry = self._glue_tables.get(view.table_key) or {}
            if entry.get("TableType") != "VIRTUAL_VIEW":
                continue
            sql = _presto_view_sql(str(entry.get("ViewOriginalText") or ""))
            if not sql:
                continue
            upstreams = [
                key
                for key in upstream_tables_from_sql(
                    sql, dialect="athena", default_database=view.database, two_level=True
                )
                if key != view.table_key and key in scoped
            ]
            if upstreams:
                results.append(ViewLineage(view.table_key, tuple(upstreams), sql))
        return results

    # ── Identity ─────────────────────────────────────────────────────────

    def _urn_authority(self) -> str:
        return f"{self.config.required.region}/{self._catalog()}"

    def _build_external_url(self, table_ref: TableRef) -> str:
        region = self.config.required.region
        return (
            f"https://{region}.console.aws.amazon.com/glue/home?region={region}"
            f"#/v2/data-catalog/tables/view/{table_ref.table}?database={table_ref.database}"
        )

    def _extra_asset_metadata(self, table_ref: TableRef) -> dict[str, Any]:
        entry = self._glue_tables.get(table_ref.table_key) or {}
        meta: dict[str, Any] = {
            "object_type": table_ref.object_type or "TABLE",
            "table_format": glue_table_format(entry) if entry else "native",
        }
        location = (entry.get("StorageDescriptor") or {}).get("Location")
        if location:
            meta["location"] = str(location)
        return meta

    def _table_ref_from_parts(self, parts: list[str]) -> TableRef | None:
        if len(parts) >= 2:
            return TableRef(database=parts[-2], schema=None, table=parts[-1])
        return None


def _presto_view_sql(original_text: str) -> str | None:
    """The SQL inside a Glue view's ``/* Presto View: <base64 json> */`` text."""
    match = _PRESTO_VIEW_RE.search(original_text)
    if not match:
        return original_text or None
    try:
        return str(json.loads(base64.b64decode(match.group("payload")))["originalSql"])
    except (ValueError, KeyError):
        return None
