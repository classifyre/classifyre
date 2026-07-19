from __future__ import annotations

import io
import tarfile
import zipfile

import pytest

from src.utils.archive_extraction import (
    ArchiveMember,
    is_archive_mime,
    iter_archive_members,
)


def _zip_bytes(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return buffer.getvalue()


def _tar_bytes(entries: dict[str, bytes], mode: str = "w") -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode=mode) as archive:
        for name, data in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()


class TestIsArchiveMime:
    def test_archive_mimes(self) -> None:
        for mime in (
            "application/zip",
            "application/x-tar",
            "application/gzip",
            "application/x-7z-compressed",
            "application/vnd.rar",
        ):
            assert is_archive_mime(mime), mime

    def test_non_archive_mimes(self) -> None:
        assert not is_archive_mime("application/pdf")
        assert not is_archive_mime(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        )
        assert not is_archive_mime("")


class TestZipMembers:
    def test_members_with_resolved_mime(self) -> None:
        data = _zip_bytes({"a.txt": b"hello text", "docs/b.csv": b"a,b,c\n1,2,3"})
        members = list(iter_archive_members(data, "application/zip"))
        by_location = {m.location: m for m in members}
        assert set(by_location) == {"a.txt", "docs/b.csv"}
        assert by_location["a.txt"].mime_type == "text/plain"
        assert by_location["docs/b.csv"].mime_type == "text/csv"
        assert by_location["a.txt"].member_bytes == b"hello text"

    def test_directories_and_empty_members_skipped(self) -> None:
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr("dir/", b"")
            archive.writestr("empty.txt", b"")
            archive.writestr("real.txt", b"content")
        members = list(iter_archive_members(buffer.getvalue(), "application/zip"))
        assert [m.location for m in members] == ["real.txt"]

    def test_oversized_member_skipped(self) -> None:
        data = _zip_bytes({"big.txt": b"x" * 2048, "small.txt": b"ok"})
        members = list(iter_archive_members(data, "application/zip", max_member_bytes=1024))
        assert [m.location for m in members] == ["small.txt"]

    def test_max_members_cap(self) -> None:
        data = _zip_bytes({f"f{i}.txt": b"data" for i in range(5)})
        members = list(iter_archive_members(data, "application/zip", max_members=2))
        assert len(members) == 2

    def test_total_budget_stops_extraction(self) -> None:
        data = _zip_bytes({"a.txt": b"x" * 600, "b.txt": b"y" * 600})
        members = list(iter_archive_members(data, "application/zip", max_total_bytes=1000))
        assert [m.location for m in members] == ["a.txt"]

    def test_nested_archive_yielded_but_not_expanded(self) -> None:
        inner = _zip_bytes({"secret.txt": b"inner content"})
        outer = _zip_bytes({"nested.zip": inner, "top.txt": b"top"})
        members = list(iter_archive_members(outer, "application/zip"))
        locations = {m.location for m in members}
        assert locations == {"nested.zip", "top.txt"}
        nested = next(m for m in members if m.location == "nested.zip")
        assert nested.mime_type == "application/zip"

    def test_corrupt_zip_yields_nothing(self) -> None:
        assert list(iter_archive_members(b"PK\x03\x04garbage", "application/zip")) == []


class TestTarMembers:
    def test_plain_tar(self) -> None:
        data = _tar_bytes({"notes/inner.txt": b"tar content"})
        members = list(iter_archive_members(data, "application/x-tar"))
        assert [(m.location, m.member_bytes) for m in members] == [
            ("notes/inner.txt", b"tar content")
        ]

    def test_tar_gz_via_gzip_mime(self) -> None:
        data = _tar_bytes({"inner.txt": b"gz tar content"}, mode="w:gz")
        members = list(iter_archive_members(data, "application/gzip"))
        assert [m.location for m in members] == ["inner.txt"]

    def test_single_file_gzip(self) -> None:
        import gzip

        data = gzip.compress(b"just one compressed file")
        members = list(iter_archive_members(data, "application/gzip", file_name="report.txt.gz"))
        assert [(m.location, m.member_bytes) for m in members] == [
            ("report.txt", b"just one compressed file")
        ]


class TestSevenZipMembers:
    def test_members_extracted(self) -> None:
        py7zr = pytest.importorskip("py7zr")
        buffer = io.BytesIO()
        with py7zr.SevenZipFile(buffer, "w") as archive:
            archive.writestr("7z file content", "inner/doc.txt")
        members = list(iter_archive_members(buffer.getvalue(), "application/x-7z-compressed"))
        assert [(m.location, m.member_bytes) for m in members] == [
            ("inner/doc.txt", b"7z file content")
        ]


class TestRarMembers:
    def test_corrupt_rar_degrades_to_no_members(self) -> None:
        # Creating a real RAR needs the proprietary rar tool; assert the
        # graceful-degradation path instead.
        data = b"Rar!\x1a\x07\x00garbage"
        assert list(iter_archive_members(data, "application/vnd.rar")) == []


class TestEdgeCases:
    def test_empty_bytes(self) -> None:
        assert list(iter_archive_members(b"", "application/zip")) == []

    def test_unknown_mime(self) -> None:
        assert list(iter_archive_members(b"data", "application/pdf")) == []

    def test_member_dataclass_is_frozen(self) -> None:
        member = ArchiveMember(location="a", member_bytes=b"b", mime_type="text/plain")
        with pytest.raises(AttributeError):
            member.location = "c"  # type: ignore[misc]
