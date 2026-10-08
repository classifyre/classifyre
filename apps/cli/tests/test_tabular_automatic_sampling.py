"""AUTOMATIC sampling of tables: a frontier where the key allows it, a wrap where not."""

from __future__ import annotations

import re
from typing import Any

import pytest

from src.sources.mysql.source import MySQLSource, TableRef
from src.utils.sampling_cursor import encode_sampling_cursor

CURSOR_ENV = "CLASSIFYRE_SAMPLING_CURSOR"
PAGE = 10  # rows_per_page (MySQL config enforces a minimum of 10)


def _recipe(rows: int = PAGE) -> dict[str, Any]:
    return {
        "type": "MYSQL",
        "required": {"host": "localhost", "port": 3306},
        "masked": {"username": "root", "password": "example"},
        "optional": {"scope": {"database": "app_db"}},
        "sampling": {"strategy": "AUTOMATIC", "rows_per_page": rows},
    }


@pytest.fixture(autouse=True)
def _patch_optional_dep(monkeypatch: pytest.MonkeyPatch) -> None:
    class _FakePyMySQL:
        def connect(self, **_kwargs: Any) -> Any:  # pragma: no cover - patched per test
            raise AssertionError("connect should be monkeypatched by test")

    monkeypatch.setattr(
        "src.sources.mysql.source.require_module",
        lambda **_kwargs: _FakePyMySQL(),
    )


class _Table:
    """An in-memory table that answers the paging queries the source issues."""

    def __init__(self, rows: list[tuple[Any, ...]]) -> None:
        self.rows = list(rows)
        self.log: list[tuple[str, list[Any]]] = []

    def cursor(self) -> _TableCursor:
        return _TableCursor(self)

    def close(self) -> None:
        return None


class _TableCursor:
    def __init__(self, table: _Table) -> None:
        self._table = table
        self.description = [("id", *([None] * 6)), ("name", *([None] * 6))]
        self._current: list[tuple[Any, ...]] = []

    def execute(self, query: str, params: Any = None) -> None:
        bound = list(params or [])
        self._table.log.append((query, list(bound)))
        rows = sorted(self._table.rows)
        for operator in re.findall(r"`id` ([<>]) %s", query):
            value = bound.pop(0)
            rows = [row for row in rows if (row[0] > value if operator == ">" else row[0] < value)]
        if "DESC" in query:
            rows.reverse()
        limit_match = re.search(r"LIMIT (\d+|%s)( OFFSET %s)?", query)
        assert limit_match is not None, query
        limit = bound.pop(0) if limit_match.group(1) == "%s" else int(limit_match.group(1))
        offset = bound.pop(0) if limit_match.group(2) else 0
        self._current = rows[offset : offset + limit]

    def fetchall(self) -> list[tuple[Any, ...]]:
        return list(self._current)

    def __enter__(self) -> _TableCursor:
        return self

    def __exit__(self, *_: Any) -> None:
        return None


def _users(start: int, count: int) -> list[tuple[Any, ...]]:
    return [(i, f"n{i}") for i in range(start, start + count)]


_TABLE = TableRef(database="app_db", schema=None, table="users")
_KEY = _TABLE.raw_id  # "app_db_#_users"


def _run(
    monkeypatch: pytest.MonkeyPatch,
    table: _Table,
    cursor: dict[str, Any] | None,
    *,
    pk: list[str] | None = None,
) -> tuple[list[tuple[Any, ...]], dict[str, Any] | None]:
    """One scan of the table: what it read, and the cursor it leaves."""
    if cursor is None:
        monkeypatch.delenv(CURSOR_ENV, raising=False)
    else:
        monkeypatch.setenv(CURSOR_ENV, encode_sampling_cursor(cursor))
    source = MySQLSource(_recipe())
    monkeypatch.setattr(source, "_available_columns", lambda _ref: ["id", "name"])
    monkeypatch.setattr(
        source, "_get_primary_key_columns", lambda _ref: ["id"] if pk is None else pk
    )
    monkeypatch.setattr(source, "_get_cached_connection", lambda _db=None: table)
    result = source._fetch_sample_rows(_TABLE)
    assert result is not None
    rows, columns = result
    assert columns == ["id", "name"]
    next_cursor = source.current_sampling_cursor()
    return rows, next_cursor if next_cursor is not None else cursor


def _ids(rows: list[tuple[Any, ...]]) -> list[Any]:
    return [row[0] for row in rows]


# ── A single integer key: new rows first, then the backfill ──────────────


def test_first_run_reads_the_newest_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    table = _Table(_users(1, 35))
    rows, cursor = _run(monkeypatch, table, None)

    assert _ids(rows) == list(range(35, 25, -1))
    query, params = table.log[0]
    assert "WHERE" not in query
    assert "ORDER BY `id` DESC" in query
    assert params == []
    assert cursor == {"tables": {_KEY: {"v": 2, "head": 35, "tail": 26, "done": False}}}


def test_rows_added_since_the_last_run_come_before_the_backfill(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = _Table(_users(1, 35))
    _, cursor = _run(monkeypatch, table, None)

    table.rows += _users(36, 3)
    rows, cursor = _run(monkeypatch, table, cursor)

    # The three new rows, then seven more of the backfill from where it stopped.
    assert _ids(rows) == [38, 37, 36, *range(25, 18, -1)]
    assert cursor == {"tables": {_KEY: {"v": 2, "head": 38, "tail": 19, "done": False}}}


def test_a_finished_table_yields_only_new_rows(monkeypatch: pytest.MonkeyPatch) -> None:
    table = _Table(_users(1, 5))
    rows, cursor = _run(monkeypatch, table, None)
    assert _ids(rows) == [5, 4, 3, 2, 1]
    assert cursor == {"tables": {_KEY: {"v": 2, "head": 5, "tail": None, "done": True}}}

    # Nothing new: nothing read, and the cursor does not move.
    rows, again = _run(monkeypatch, table, cursor)
    assert rows == []
    assert again == cursor

    table.rows += _users(6, 2)
    rows, cursor = _run(monkeypatch, table, cursor)
    assert _ids(rows) == [7, 6]
    assert cursor == {"tables": {_KEY: {"v": 2, "head": 7, "tail": None, "done": True}}}


def test_more_new_rows_than_a_page_are_read_down_to_old_ground(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = _Table(_users(1, 5))
    _, cursor = _run(monkeypatch, table, None)

    table.rows += _users(6, 25)  # 6..30, a page is 10
    seen: list[Any] = []
    for _ in range(4):
        rows, cursor = _run(monkeypatch, table, cursor)
        seen += _ids(rows)

    assert seen == list(range(30, 5, -1))
    assert cursor == {"tables": {_KEY: {"v": 2, "head": 30, "tail": None, "done": True}}}


def test_every_row_is_read_exactly_once(monkeypatch: pytest.MonkeyPatch) -> None:
    table = _Table(_users(1, 47))
    seen: list[Any] = []
    cursor: dict[str, Any] | None = None
    for run in range(12):
        if run in {2, 5}:
            table.rows += _users(len(table.rows) + 1, 13)
        rows, cursor = _run(monkeypatch, table, cursor)
        seen += _ids(rows)

    assert sorted(seen) == list(range(1, 74))
    assert len(seen) == len(set(seen))


def test_the_cursor_advances_once_per_run(monkeypatch: pytest.MonkeyPatch) -> None:
    # fetch_content and fetch_content_pages may both sample a table in one run;
    # both must read the same rows and leave the same cursor.
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    table = _Table(_users(1, 35))
    source = MySQLSource(_recipe())
    monkeypatch.setattr(source, "_available_columns", lambda _ref: ["id", "name"])
    monkeypatch.setattr(source, "_get_primary_key_columns", lambda _ref: ["id"])
    monkeypatch.setattr(source, "_get_cached_connection", lambda _db=None: table)

    first = source._fetch_sample_rows(_TABLE)
    second = source._fetch_sample_rows(_TABLE)

    assert first == second
    assert source.current_sampling_cursor() == {
        "tables": {_KEY: {"v": 2, "head": 35, "tail": 26, "done": False}}
    }


# ── Any other table cannot tell new from old: walk it, then walk it again ──


def test_a_string_key_is_walked_and_wrapped(monkeypatch: pytest.MonkeyPatch) -> None:
    table = _Table([(f"u{i:03d}", f"n{i}") for i in range(25)])

    rows, cursor = _run(monkeypatch, table, None)
    assert _ids(rows) == [f"u{i:03d}" for i in range(10)]
    assert cursor == {"tables": {_KEY: {"mode": "wrap", "pk": ["u009"]}}}

    rows, cursor = _run(monkeypatch, table, cursor)
    assert _ids(rows) == [f"u{i:03d}" for i in range(10, 20)]

    rows, cursor = _run(monkeypatch, table, cursor)
    assert _ids(rows) == [f"u{i:03d}" for i in range(20, 25)]
    # Exhausted: no position is kept, so the next run starts the walk again --
    # and it stays a walk, without asking the table what kind of key it has.
    assert cursor == {"tables": {_KEY: {"mode": "wrap"}}}

    queries_before = len(table.log)
    rows, _ = _run(monkeypatch, table, cursor)
    assert _ids(rows) == [f"u{i:03d}" for i in range(10)]
    assert len(table.log) == queries_before + 1


def test_a_table_without_a_key_is_paged_by_offset_and_wraps(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    table = _Table(_users(1, 15))

    rows, cursor = _run(monkeypatch, table, None, pk=[])
    assert _ids(rows) == list(range(1, 11))
    assert "OFFSET" in table.log[0][0]
    assert cursor == {"tables": {_KEY: {"mode": "wrap", "offset": 10}}}

    rows, cursor = _run(monkeypatch, table, cursor, pk=[])
    assert _ids(rows) == list(range(11, 16))
    assert cursor == {"tables": {_KEY: {"mode": "wrap"}}}


def test_the_old_cursor_format_starts_fresh(monkeypatch: pytest.MonkeyPatch) -> None:
    table = _Table(_users(1, 35))
    rows, cursor = _run(monkeypatch, table, {"tables": {_KEY: {"pk": [20]}}})

    assert _ids(rows) == list(range(35, 25, -1))
    assert cursor == {"tables": {_KEY: {"v": 2, "head": 35, "tail": 26, "done": False}}}
