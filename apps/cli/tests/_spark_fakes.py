"""Lightweight fakes for the Spark-backed source tests (no real PySpark/JVM).

A ``FakeSparkSession`` answers the small set of Spark SQL statements the sources
issue (``SHOW DATABASES``/``SHOW TABLES``, schema probes, content ``SELECT``s,
``DESCRIBE`` variants) and records every query so tests can assert query shapes.
"""

from __future__ import annotations

import re
from typing import Any


class FakeField:
    def __init__(self, name: str, dtype: str = "string") -> None:
        self.name = name
        self.dataType = _FakeType(dtype)


class _FakeType:
    def __init__(self, dtype: str) -> None:
        self._dtype = dtype

    def simpleString(self) -> str:  # noqa: N802 - mirrors PySpark API
        return self._dtype


class FakeSchema:
    def __init__(self, columns: list[tuple[str, str]]) -> None:
        self.fields = [FakeField(name, dtype) for name, dtype in columns]
        self.names = [name for name, _ in columns]


class FakeDataFrame:
    def __init__(self, columns: list[tuple[str, str]], rows: list[tuple[Any, ...]]) -> None:
        self.schema = FakeSchema(columns)
        self._rows = rows

    def collect(self) -> list[tuple[Any, ...]]:
        return list(self._rows)

    def toLocalIterator(self) -> Any:  # noqa: N802 - mirrors PySpark API
        return iter(self._rows)


def _slice_limit_offset(query: str, rows: list[tuple[Any, ...]]) -> list[tuple[Any, ...]]:
    limit_match = re.search(r"LIMIT (\d+)", query, re.IGNORECASE)
    offset_match = re.search(r"OFFSET (\d+)", query, re.IGNORECASE)
    offset = int(offset_match.group(1)) if offset_match else 0
    if limit_match:
        limit = int(limit_match.group(1))
        return rows[offset : offset + limit]
    return rows[offset:]


class FakeSparkSession:
    def __init__(
        self,
        *,
        databases: list[str] | None = None,
        tables: dict[str, list[str]] | None = None,
        fields: list[tuple[str, str]] | None = None,
        rows: list[tuple[Any, ...]] | None = None,
        detail: dict[str, Any] | None = None,
        history_count: int = 0,
        tblproperties: list[tuple[str, str]] | None = None,
        provider_rows: list[tuple[str, str]] | None = None,
    ) -> None:
        self.databases = databases or []
        self.tables = tables or {}
        self.fields = fields or [("id", "int"), ("name", "string")]
        self.rows = rows or []
        self.detail = detail
        self.history_count = history_count
        self.tblproperties = tblproperties or []
        self.provider_rows = provider_rows or []
        self.queries: list[str] = []

    def sql(self, query: str, *_args: Any, **_kwargs: Any) -> FakeDataFrame:
        self.queries.append(query)
        upper = query.strip().upper()
        if upper == "SELECT 1":
            return FakeDataFrame([("one", "int")], [(1,)])
        if upper.startswith("SHOW DATABASES") or upper.startswith("SHOW NAMESPACES"):
            return FakeDataFrame([("namespace", "string")], [(d,) for d in self.databases])
        if upper.startswith("SHOW TABLES"):
            db = self._extract_db(query)
            cols = [("namespace", "string"), ("tableName", "string"), ("isTemporary", "boolean")]
            return FakeDataFrame(cols, [(db, t, False) for t in self.tables.get(db, [])])
        if "LIMIT 0" in upper:
            return FakeDataFrame(self.fields, [])
        if upper.startswith("DESCRIBE DETAIL"):
            cols = [("numFiles", "long"), ("partitionColumns", "array"),
                    ("minReaderVersion", "int")]
            row = (
                self.detail.get("numFiles"),
                self.detail.get("partitionColumns"),
                self.detail.get("minReaderVersion"),
            ) if self.detail else (None, None, None)
            return FakeDataFrame(cols, [row])
        if "DESCRIBE HISTORY" in upper:
            return FakeDataFrame([("count", "long")], [(self.history_count,)])
        if upper.startswith("SHOW TBLPROPERTIES"):
            return FakeDataFrame([("key", "string"), ("value", "string")], self.tblproperties)
        if upper.startswith("DESCRIBE TABLE EXTENDED"):
            return FakeDataFrame([("col_name", "string"), ("data_type", "string")],
                                 self.provider_rows)
        if upper.startswith("SELECT"):
            return FakeDataFrame(self.fields, _slice_limit_offset(query, self.rows))
        return FakeDataFrame([], [])

    @staticmethod
    def _extract_db(query: str) -> str:
        match = re.search(r"IN\s+`([^`]+)`(?:\.`([^`]+)`)?", query)
        if not match:
            return "default"
        return match.group(2) or match.group(1)
