"""The notebook's file surface: ctx.files, ctx.folder and parse().

The point of exposing the parser is that a connector author never writes format
handling, so these check the two things that would send them back to writing it:
that a real file of each shape comes back with usable text, and that an
unreadable one reports itself instead of ending the run.
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from src.notebook.files import ParsedContent, pages, parse
from src.notebook.sdk import Context, NotebookFile


@pytest.fixture
def corpus(tmp_path: Path) -> Path:
    (tmp_path / "record.json").write_text(
        json.dumps({"customer": "ACME", "email": "a@example.com"}), encoding="utf-8"
    )
    (tmp_path / "notes.txt").write_text("plain text notes", encoding="utf-8")
    (tmp_path / "rows.csv").write_text("name,email\nAda,ada@example.com\n", encoding="utf-8")
    return tmp_path


def test_parse_reads_a_json_file_by_path(corpus: Path) -> None:
    parsed = parse(corpus / "record.json")
    assert parsed.error is None
    assert parsed.mime_type == "application/json"
    assert "ACME" in parsed.text


def test_parse_reads_raw_bytes_with_a_declared_type() -> None:
    parsed = parse(b"name,email\nAda,ada@example.com\n", name="rows.csv")
    assert parsed.error is None
    assert "ada@example.com" in parsed.text


def test_parse_reads_an_open_handle() -> None:
    parsed = parse(io.BytesIO(b"hello from a handle"), name="notes.txt")
    assert parsed.error is None
    assert "hello from a handle" in parsed.text


def test_parse_accepts_a_notebook_file_directly(corpus: Path) -> None:
    file = NotebookFile(name="record.json", path=corpus / "record.json")
    assert "ACME" in file.parse().text


def test_parse_detects_a_binary_container() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("inner.txt", "secret-looking content")
    parsed = parse(buffer.getvalue(), name="bundle.zip")
    assert parsed.is_binary
    assert "zip" in parsed.mime_type


def test_a_missing_file_reports_instead_of_raising(tmp_path: Path) -> None:
    # A corrupt or vanished attachment must cost one asset, not the whole scan.
    parsed = parse(tmp_path / "does-not-exist.pdf")
    assert isinstance(parsed, ParsedContent)
    assert parsed.error
    assert not parsed


def test_parsed_content_is_falsey_only_on_error(corpus: Path) -> None:
    assert parse(corpus / "notes.txt")


def test_pages_streams_a_csv_in_row_batches(corpus: Path) -> None:
    rows = "\n".join(f"row{index},value{index}" for index in range(250))
    path = corpus / "big.csv"
    path.write_text(f"name,value\n{rows}\n", encoding="utf-8")
    produced = list(pages(path, page_size=100))
    assert len(produced) > 1
    assert "row0" in produced[0]


class TestContextFiles:
    def test_files_are_listed_by_name(self, corpus: Path) -> None:
        ctx = Context(files_dir=corpus)
        assert [file.name for file in ctx.files] == ["notes.txt", "record.json", "rows.csv"]

    def test_no_files_is_a_normal_state(self, tmp_path: Path) -> None:
        assert Context().files == []
        assert Context(files_dir=tmp_path / "never-created").files == []

    def test_a_file_can_be_fetched_by_name(self, corpus: Path) -> None:
        ctx = Context(files_dir=corpus)
        assert ctx.file("notes.txt").read_text() == "plain text notes"

    def test_an_unknown_file_names_what_is_there(self, corpus: Path) -> None:
        ctx = Context(files_dir=corpus)
        with pytest.raises(KeyError, match=r"notes\.txt"):
            ctx.file("absent.txt")

    def test_size_comes_from_disk(self, corpus: Path) -> None:
        ctx = Context(files_dir=corpus)
        assert ctx.file("notes.txt").size_bytes == len("plain text notes")


class TestContextFolders:
    def test_configured_folders_are_paths(self, tmp_path: Path) -> None:
        ctx = Context(folders={"dumps": str(tmp_path)})
        assert ctx.folder("dumps") == tmp_path
        assert ctx.folders == {"dumps": tmp_path}

    def test_no_folders_configured(self) -> None:
        assert Context().folders == {}

    def test_an_unknown_folder_names_what_is_configured(self, tmp_path: Path) -> None:
        ctx = Context(folders={"dumps": str(tmp_path)})
        with pytest.raises(KeyError, match="dumps"):
            ctx.folder("exports")
