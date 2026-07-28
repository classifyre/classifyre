from __future__ import annotations

from pathlib import Path

import pytest

from src.utils import legacy_office
from src.utils.legacy_office import SOFFICE_PATH_ENV, convert_legacy_office, find_soffice

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
_XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"


@pytest.fixture(autouse=True)
def _clear_soffice_cache() -> object:
    """find_soffice() is @cache'd, so every environment tweak needs a reset."""
    find_soffice.cache_clear()
    yield
    find_soffice.cache_clear()


class TestFindSoffice:
    """The resolution contract each deployment relies on.

    Kubernetes finds /usr/bin/soffice on PATH (the libreoffice-*-nogui packages
    baked into the CLI image); the packaged desktop app rebuilds a minimal PATH
    that excludes /Applications, so macOS and Windows depend on the platform
    fallback table; operators and the desktop override both with an env var.
    """

    def test_env_override_wins_over_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        override = tmp_path / "custom-soffice"
        override.write_text("#!/bin/sh\n")
        monkeypatch.setattr(legacy_office.shutil, "which", lambda _name: "/usr/bin/soffice")
        monkeypatch.setenv(SOFFICE_PATH_ENV, str(override))

        assert find_soffice() == str(override)

    def test_env_override_pointing_nowhere_falls_back_to_path(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
    ) -> None:
        monkeypatch.setattr(
            legacy_office.shutil,
            "which",
            lambda name: "/usr/bin/soffice" if name == "soffice" else None,
        )
        monkeypatch.setenv(SOFFICE_PATH_ENV, str(tmp_path / "does-not-exist"))

        assert find_soffice() == "/usr/bin/soffice"

    def test_path_lookup_finds_container_install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """The CLI image installs /usr/bin/soffice; no fallback should be needed."""
        monkeypatch.delenv(SOFFICE_PATH_ENV, raising=False)
        monkeypatch.setattr(
            legacy_office.shutil,
            "which",
            lambda name: "/usr/bin/soffice" if name == "soffice" else None,
        )
        monkeypatch.setattr(legacy_office.sys, "platform", "linux")

        assert find_soffice() == "/usr/bin/soffice"

    @pytest.mark.parametrize("platform", ["darwin", "win32", "linux"])
    def test_platform_fallback_used_when_path_is_scrubbed(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path, platform: str
    ) -> None:
        """Reproduces packaged-desktop mode: PATH holds no LibreOffice at all.

        macOS/Windows installers never touch PATH, and the packaged app rebuilds
        a minimal one; on Linux this covers an upstream tarball install in /opt.
        """
        installed = tmp_path / "soffice"
        installed.write_text("#!/bin/sh\n")
        monkeypatch.delenv(SOFFICE_PATH_ENV, raising=False)
        monkeypatch.setattr(legacy_office.shutil, "which", lambda _name: None)
        monkeypatch.setattr(legacy_office.sys, "platform", platform)
        monkeypatch.setitem(legacy_office._SOFFICE_FALLBACK_PATHS, platform, (str(installed),))

        assert find_soffice() == str(installed)

    @pytest.mark.parametrize("platform", ["darwin", "win32", "linux"])
    def test_every_supported_platform_has_fallback_paths(self, platform: str) -> None:
        """A platform missing from the table silently loses discovery on hosts
        whose installer does not touch PATH."""
        assert legacy_office._SOFFICE_FALLBACK_PATHS.get(platform)

    def test_fallback_paths_are_absolute(self) -> None:
        for platform, candidates in legacy_office._SOFFICE_FALLBACK_PATHS.items():
            for candidate in candidates:
                assert candidate.startswith(("/", "C:\\")), f"{platform}: {candidate}"

    def test_missing_everywhere_returns_none(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.delenv(SOFFICE_PATH_ENV, raising=False)
        monkeypatch.setattr(legacy_office.shutil, "which", lambda _name: None)
        monkeypatch.setattr(legacy_office.sys, "platform", "darwin")
        monkeypatch.setitem(legacy_office._SOFFICE_FALLBACK_PATHS, "darwin", ())

        assert find_soffice() is None


class TestConvertLegacyOffice:
    def test_unsupported_mime_returns_error(self) -> None:
        converted, target_mime, error = convert_legacy_office(b"data", "application/pdf")
        assert converted is None
        assert target_mime == ""
        assert error is not None and "Unsupported" in error

    def test_missing_soffice_returns_structured_error(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(legacy_office, "find_soffice", lambda: None)
        converted, target_mime, error = convert_legacy_office(b"data", "application/msword")
        assert converted is None
        assert target_mime == _DOCX_MIME
        assert error is not None and "LibreOffice" in error

    def test_missing_soffice_is_reported_as_engine_unavailable(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A missing binary is a broken deployment, not a broken document.

        iter_file_pages must raise — a silent empty result would let the asset be
        recorded as scanned-and-empty, which is indistinguishable from a genuinely
        empty file. The ENGINE_UNAVAILABLE code is what separates "this install
        cannot read .doc at all" from "this one file failed".
        """
        from src.utils.file_parser import (
            TextExtractionCoverageCode,
            TextExtractionCoverageError,
            iter_file_pages,
        )

        monkeypatch.setattr(legacy_office, "find_soffice", lambda: None)

        with pytest.raises(TextExtractionCoverageError) as excinfo:
            list(iter_file_pages(b"\xd0\xcf\x11\xe0", "application/msword", file_name="x.doc"))

        assert excinfo.value.code is TextExtractionCoverageCode.ENGINE_UNAVAILABLE
        # The operator has to be able to act on it without reading our source.
        assert "CLASSIFYRE_SOFFICE_PATH" in str(excinfo.value)

    @pytest.mark.parametrize(
        ("platform", "expected_hint"),
        [
            ("darwin", "brew install --cask libreoffice"),
            ("win32", "libreoffice.org/download"),
            ("linux", "apt install libreoffice-writer"),
        ],
    )
    def test_install_hint_matches_the_platform(
        self, monkeypatch: pytest.MonkeyPatch, platform: str, expected_hint: str
    ) -> None:
        """The desktop app ships no LibreOffice, so this message is the user's
        whole remediation path — a macOS user must not be told to run apt."""
        monkeypatch.setattr(legacy_office.sys, "platform", platform)

        message = legacy_office.soffice_missing_error()

        assert expected_hint in message
        # Keeps the ENGINE_UNAVAILABLE classification working (see iter_file_pages).
        assert "unavailable" in message.casefold()

    def test_install_hint_falls_back_on_unknown_platform(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(legacy_office.sys, "platform", "freebsd14")

        message = legacy_office.soffice_missing_error()

        assert "install LibreOffice" in message
        assert "unavailable" in message.casefold()


# Fixture bodies chosen so LibreOffice can genuinely *import* them: Writer reads
# plain text, Calc reads CSV, Impress reads flat ODF. (Feeding .txt to Calc or
# Impress fails with "no export filter" and silently produces nothing.)
_SAMPLE_TEXT = "Legacy document body text."
_SAMPLE_CSV = "name,ssn\nAlice,123-45-6789\n"
_SAMPLE_FODP = """<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 office:version="1.2"
 office:mimetype="application/vnd.oasis.opendocument.presentation">
 <office:body><office:presentation>
  <draw:page draw:name="page1">
   <draw:frame svg:width="10cm" svg:height="2cm" svg:x="1cm" svg:y="1cm">
    <draw:text-box><text:p>Legacy slide body text.</text:p></draw:text-box>
   </draw:frame>
  </draw:page>
 </office:presentation></office:body>
</office:document>
"""


def _build_legacy_fixture(tmp_path: Path, file_name: str, body: str, legacy_ext: str) -> bytes:
    """Produce a genuine legacy binary (.doc/.xls/.ppt) with the same soffice."""
    import subprocess

    soffice = find_soffice()
    assert soffice is not None
    source = tmp_path / file_name
    source.write_text(body)
    subprocess.run(
        [
            soffice,
            "--headless",
            "--norestore",
            f"-env:UserInstallation={(tmp_path / 'fixture-profile').as_uri()}",
            "--convert-to",
            legacy_ext,
            "--outdir",
            str(tmp_path),
            str(source),
        ],
        capture_output=True,
        timeout=120,
        check=True,
    )
    produced = tmp_path / f"{source.stem}.{legacy_ext}"
    assert produced.is_file(), f"LibreOffice did not produce {produced.name}"
    return produced.read_bytes()


@pytest.mark.skipif(find_soffice() is None, reason="LibreOffice not installed")
class TestLegacyOfficeRoundTrip:
    """Covers all three formats the CLI image installs an import filter for.

    Each one needs its own libreoffice-*-nogui package, so a per-format test is
    what catches a Dockerfile that dropped calc or impress.
    """

    @pytest.mark.parametrize(
        "case",
        [
            ("sample.txt", _SAMPLE_TEXT, "doc", "application/msword", _DOCX_MIME),
            ("sample.csv", _SAMPLE_CSV, "xls", "application/vnd.ms-excel", _XLSX_MIME),
            ("sample.fodp", _SAMPLE_FODP, "ppt", "application/vnd.ms-powerpoint", _PPTX_MIME),
        ],
        ids=["doc", "xls", "ppt"],
    )
    def test_legacy_binary_converts_to_ooxml(
        self,
        tmp_path: Path,
        case: tuple[str, str, str, str, str],
    ) -> None:
        file_name, body, legacy_ext, legacy_mime, target_mime = case
        legacy_bytes = _build_legacy_fixture(tmp_path, file_name, body, legacy_ext)

        converted, resolved_mime, error = convert_legacy_office(legacy_bytes, legacy_mime)

        assert error is None
        assert resolved_mime == target_mime
        assert converted is not None and converted.startswith(b"PK\x03\x04")

    def test_doc_text_reaches_detectors(self, tmp_path: Path) -> None:
        from src.utils.file_parser import extract_text

        doc_bytes = _build_legacy_fixture(tmp_path, "sample.txt", _SAMPLE_TEXT, "doc")

        text, extract_error = extract_text(doc_bytes, "application/msword", file_name="sample.doc")

        assert extract_error is None
        assert _SAMPLE_TEXT in text

    def test_xls_cell_values_reach_detectors(self, tmp_path: Path) -> None:
        """The Enron corpus failure case: a .xls scanned as "no content"."""
        from src.utils.file_parser import extract_text

        xls_bytes = _build_legacy_fixture(tmp_path, "sample.csv", _SAMPLE_CSV, "xls")

        text, extract_error = extract_text(
            xls_bytes, "application/vnd.ms-excel", file_name="sample.xls"
        )

        assert extract_error is None
        assert "123-45-6789" in text
