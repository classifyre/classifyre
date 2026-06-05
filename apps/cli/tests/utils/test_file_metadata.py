"""Tests for file_metadata.extract_file_metadata."""

from __future__ import annotations

import csv
import io

from src.utils.file_metadata import build_columns, extract_file_metadata

# ── CSV ─────────────────────────────────────────────────────────────────────


def _make_csv(rows: int, columns: int = 3) -> bytes:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow([f"col{i}" for i in range(columns)])
    for r in range(rows):
        writer.writerow([f"v{r}_{c}" for c in range(columns)])
    return buf.getvalue().encode()


def test_csv_row_count_basic() -> None:
    data = _make_csv(10)
    meta = extract_file_metadata(data, "text/csv", file_name="data.csv")
    assert meta["row_count"] == 10


def test_csv_row_count_large_file_beyond_scan_cap() -> None:
    """Row count must be accurate even when the file exceeds the 5 MB scan cap."""
    # Build a CSV where each row is ~1 KB → 10 000 rows ≈ 10 MB (well above 5 MB cap).
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["id", "payload"])
    expected_rows = 10_000
    for i in range(expected_rows):
        writer.writerow([str(i), "x" * 1000])
    data = buf.getvalue().encode()
    assert len(data) > 5 * 1024 * 1024, "test data must exceed 5 MB to be meaningful"

    meta = extract_file_metadata(data, "text/csv", file_name="big.csv")
    assert meta["row_count"] == expected_rows


def test_csv_columns_extracted() -> None:
    data = _make_csv(5, columns=4)
    meta = extract_file_metadata(data, "text/csv", file_name="data.csv")
    assert meta["columns"] == build_columns(["col0", "col1", "col2", "col3"])


def test_csv_multiline_field_counted_as_one_row() -> None:
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["name", "note"])
    writer.writerow(["Alice", "line one\nline two"])
    writer.writerow(["Bob", "single"])
    data = buf.getvalue().encode()

    meta = extract_file_metadata(data, "text/csv", file_name="ml.csv")
    assert meta["row_count"] == 2


def test_tsv_row_count() -> None:
    rows = b"a\tb\tc\n1\t2\t3\n4\t5\t6\n"
    meta = extract_file_metadata(rows, "text/tab-separated-values", file_name="data.tsv")
    assert meta["row_count"] == 2
    assert meta["columns"][0]["name"] == "a"


# ── build_columns ────────────────────────────────────────────────────────────


def test_build_columns_with_types() -> None:
    result = build_columns(["id", "name"], {"id": "integer", "name": "varchar"})
    assert result == [{"name": "id", "type": "integer"}, {"name": "name", "type": "varchar"}]


def test_build_columns_without_types() -> None:
    result = build_columns(["x", "y"])
    assert result == [{"name": "x", "type": ""}, {"name": "y", "type": ""}]
