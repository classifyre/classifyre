"""AUTOMATIC keyset/offset cursor tests for the shared tabular base class."""

from __future__ import annotations

import base64
import json
from typing import Any

import pytest

from src.sources.mysql.source import MySQLSource, TableRef

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


def _rows(start: int, count: int) -> list[tuple[Any, ...]]:
    return [(i, f"n{i}") for i in range(start, start + count)]


class _RecordingCursor:
    """Cursor that records queries and returns a caller-supplied page of rows."""

    def __init__(self, pages: list[list[tuple[Any, ...]]], log: list[tuple[str, list[Any]]]):
        self._pages = pages
        self._log = log
        self.description = [("id", *([None] * 6)), ("name", *([None] * 6))]
        self._current: list[tuple[Any, ...]] = []

    def execute(self, query: str, params: Any = None) -> None:
        self._log.append((query, list(params) if params else []))
        self._current = self._pages.pop(0) if self._pages else []

    def fetchall(self) -> list[tuple[Any, ...]]:
        return list(self._current)

    def __enter__(self) -> _RecordingCursor:
        return self

    def __exit__(self, *_: Any) -> None:
        return None


class _RecordingConnection:
    def __init__(self, pages: list[list[tuple[Any, ...]]], log: list[tuple[str, list[Any]]]):
        self._pages = pages
        self._log = log

    def cursor(self) -> _RecordingCursor:
        return _RecordingCursor(self._pages, self._log)

    def close(self) -> None:
        return None


def _make_source(
    monkeypatch: pytest.MonkeyPatch,
    page: list[tuple[Any, ...]],
    *,
    pk: list[str] | None = None,
) -> tuple[MySQLSource, list[tuple[str, list[Any]]]]:
    source = MySQLSource(_recipe())
    log: list[tuple[str, list[Any]]] = []
    monkeypatch.setattr(source, "_available_columns", lambda _ref: ["id", "name"])
    monkeypatch.setattr(
        source, "_get_primary_key_columns", lambda _ref: ["id"] if pk is None else pk
    )
    monkeypatch.setattr(
        source, "_get_cached_connection", lambda _db=None: _RecordingConnection([page], log)
    )
    return source, log


def _encode(cursor: dict[str, Any]) -> str:
    return base64.b64encode(json.dumps(cursor).encode()).decode()


_TABLE = TableRef(database="app_db", schema=None, table="users")
_KEY = _TABLE.raw_id  # "app_db_#_users"


def test_automatic_first_run_keyset_from_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    page = _rows(1, PAGE)
    source, log = _make_source(monkeypatch, page)

    result = source._fetch_sample_rows(_TABLE)

    assert result is not None
    rows, columns = result
    assert rows == page
    assert columns == ["id", "name"]
    # First run has no WHERE clause and orders by the primary key with a LIMIT.
    query, params = log[0]
    assert "WHERE" not in query
    assert "ORDER BY" in query and "`id`" in query
    assert params == [PAGE]
    # Full page → cursor advances to the last row's primary key.
    assert source.current_sampling_cursor() == {"tables": {_KEY: {"pk": [PAGE]}}}


def test_automatic_second_run_resumes_after_saved_pk(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(CURSOR_ENV, _encode({"tables": {_KEY: {"pk": [PAGE]}}}))
    page = _rows(PAGE + 1, PAGE)
    source, log = _make_source(monkeypatch, page)

    result = source._fetch_sample_rows(_TABLE)

    assert result is not None
    rows, _ = result
    assert rows == page
    query, params = log[0]
    assert "WHERE" in query and "`id` >" in query
    assert params == [PAGE, PAGE]  # [last_pk, page_size]
    assert source.current_sampling_cursor() == {"tables": {_KEY: {"pk": [PAGE * 2]}}}


def test_automatic_wraps_when_page_underfills(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(CURSOR_ENV, _encode({"tables": {_KEY: {"pk": [PAGE * 2]}}}))
    page = _rows(PAGE * 2 + 1, 1)  # fewer than rows_per_page → table exhausted
    source, _ = _make_source(monkeypatch, page)

    source._fetch_sample_rows(_TABLE)

    # Exhausted tables are dropped so the next run restarts from the beginning.
    assert source.current_sampling_cursor() == {"tables": {}}


def test_automatic_offset_mode_without_primary_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    page = _rows(1, PAGE)
    source, log = _make_source(monkeypatch, page, pk=[])

    result = source._fetch_sample_rows(_TABLE)

    assert result is not None
    # No PK → OFFSET pagination (LIMIT … OFFSET …), cursor stores the offset.
    query, _params = log[0]
    assert "OFFSET" in query
    assert source.current_sampling_cursor() == {"tables": {_KEY: {"offset": PAGE}}}


def test_automatic_advances_cursor_once_per_run(monkeypatch: pytest.MonkeyPatch) -> None:
    # fetch_content and fetch_content_pages may both sample a table in one run;
    # the cursor must advance only once (idempotent on the saved cursor).
    monkeypatch.delenv(CURSOR_ENV, raising=False)
    source = MySQLSource(_recipe())
    monkeypatch.setattr(source, "_available_columns", lambda _ref: ["id", "name"])
    monkeypatch.setattr(source, "_get_primary_key_columns", lambda _ref: ["id"])
    log: list[tuple[str, list[Any]]] = []
    monkeypatch.setattr(
        source,
        "_get_cached_connection",
        lambda _db=None: _RecordingConnection([_rows(1, PAGE)], log),
    )

    source._fetch_sample_rows(_TABLE)
    # Re-seed the page for the second sampling call within the same run.
    monkeypatch.setattr(
        source,
        "_get_cached_connection",
        lambda _db=None: _RecordingConnection([_rows(1, PAGE)], log),
    )
    source._fetch_sample_rows(_TABLE)

    assert source.current_sampling_cursor() == {"tables": {_KEY: {"pk": [PAGE]}}}
