"""Row paging for SQL engines whose drivers cannot bind ``LIMIT``/``OFFSET``.

Trino, Athena and BigQuery take parameters in predicates but not as the row
count of a ``LIMIT``, so the page bounds are written into the query (they are
integers the source computed, never user text). Paging is ``OFFSET`` based: none
of these engines enforce primary keys, so there is no key to page by.
"""

from __future__ import annotations

from typing import Any

from ..models.generated_input import SamplingStrategy
from .tabular_utils import TableRef


class InlinePagingMixin:
    """``_build_sampling_query`` and ``_fetch_one_page`` with inline bounds."""

    def _build_sampling_query(
        self, table_ref: TableRef, columns: list[str]
    ) -> tuple[str, list[Any]]:
        sampling = self._sampling()  # type: ignore[attr-defined]
        if not columns:
            raise ValueError(f"Table {table_ref.display_name} has no readable columns")
        quoted = ", ".join(self._quote_identifier(c) for c in columns)  # type: ignore[attr-defined]
        query = f"SELECT {quoted} FROM {self._table_select_fqn(table_ref)}"  # type: ignore[attr-defined]
        strategy = sampling.strategy
        if strategy == SamplingStrategy.ALL:
            return query, []
        if strategy == SamplingStrategy.LATEST:
            order_column = self._resolve_latest_order_column(columns)  # type: ignore[attr-defined]
            if order_column:
                query += f" ORDER BY {self._quote_identifier(order_column)} DESC"  # type: ignore[attr-defined]
            elif sampling.fallback_to_random is not False:
                query += f" ORDER BY {self._random_order_expr()}"  # type: ignore[attr-defined]
        elif strategy == SamplingStrategy.RANDOM:
            query += f" ORDER BY {self._random_order_expr()}"  # type: ignore[attr-defined]
        query += f" LIMIT {int(sampling.rows_per_page or 100)}"
        return query, []

    def _fetch_one_page(
        self, table_ref: TableRef, base_query: str, page_size: int, offset: int
    ) -> tuple[list[tuple[Any, ...]], list[str]]:
        conn = self._get_cached_connection(table_ref.database)  # type: ignore[attr-defined]
        query = f"{base_query} {self._inline_window(int(page_size), int(offset))}"
        cursor = conn.cursor()
        try:
            cursor.execute(query)
            rows = [tuple(row) for row in cursor.fetchall()]
            description = cursor.description or []
            columns = [str(column[0]) for column in description]
        finally:
            close = getattr(cursor, "close", None)
            if callable(close):
                close()
        return rows, columns

    def _inline_window(self, page_size: int, offset: int) -> str:
        """``OFFSET … LIMIT …``; Trino and Athena want OFFSET first."""
        return f"OFFSET {offset} LIMIT {page_size}"

    def _automatic_supports_keyset(self) -> bool:
        return False
