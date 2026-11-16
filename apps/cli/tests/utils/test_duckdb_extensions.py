"""Loading DuckDB extensions from the image's own copy (Dockerfile, cli-builder)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from src.utils import duckdb_engine


class _Conn:
    """Answers LOAD of a file under the baked directory; refuses LOAD by name."""

    def __init__(self) -> None:
        self.loaded: list[str] = []
        self._last: Any = None

    def execute(self, sql: str) -> _Conn:
        if sql == "SELECT version()":
            self._last = ("v9.9.9",)
        elif sql == "PRAGMA platform":
            self._last = ("linux_test",)
        elif sql.startswith("LOAD '"):
            self.loaded.append(Path(sql[6:-1]).name)
        elif sql.startswith(("LOAD ", "INSTALL ")):
            raise RuntimeError(f"not here: {sql}")
        return self

    def fetchone(self) -> Any:
        return self._last


def test_iceberg_loads_avro_from_the_image_first(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    folder = tmp_path / "v9.9.9" / "linux_test"
    folder.mkdir(parents=True)
    for name in ("avro", "iceberg"):
        (folder / f"{name}.duckdb_extension").write_bytes(b"")
    monkeypatch.setenv(duckdb_engine.BAKED_EXTENSION_DIR_ENV, str(tmp_path))
    conn = _Conn()
    duckdb_engine.load_extension(conn, "iceberg")
    assert conn.loaded == ["avro.duckdb_extension", "iceberg.duckdb_extension"]


def test_baked_extensions_load_in_a_real_duckdb() -> None:
    duckdb = pytest.importorskip("duckdb")
    root = Path("/opt/duckdb-extensions")
    if not root.is_dir():
        pytest.skip("no baked extensions here (they are in the CLI image)")
    conn = duckdb.connect()
    conn.execute("SET autoinstall_known_extensions = false")
    duckdb_engine.load_extension(conn, "iceberg")
