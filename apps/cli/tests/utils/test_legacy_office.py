from __future__ import annotations

import pytest

from src.utils import legacy_office
from src.utils.legacy_office import convert_legacy_office, find_soffice

_DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


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

    @pytest.mark.skipif(find_soffice() is None, reason="LibreOffice not installed")
    def test_doc_converts_to_extractable_docx(self, tmp_path: object) -> None:
        import subprocess
        import tempfile
        from pathlib import Path

        # Build a real .doc from plain text using the same soffice binary.
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "sample.txt"
            source.write_text("Legacy document body text.")
            soffice = find_soffice()
            assert soffice is not None
            subprocess.run(
                [
                    soffice,
                    "--headless",
                    "--norestore",
                    f"-env:UserInstallation={(Path(temp_dir) / 'profile').as_uri()}",
                    "--convert-to",
                    "doc",
                    "--outdir",
                    temp_dir,
                    str(source),
                ],
                capture_output=True,
                timeout=120,
                check=True,
            )
            doc_bytes = (Path(temp_dir) / "sample.doc").read_bytes()

        converted, target_mime, error = convert_legacy_office(doc_bytes, "application/msword")
        assert error is None
        assert target_mime == _DOCX_MIME
        assert converted is not None and converted.startswith(b"PK\x03\x04")

        from src.utils.file_parser import extract_text

        text, extract_error = extract_text(doc_bytes, "application/msword", file_name="sample.doc")
        assert extract_error is None
        assert "Legacy document body text." in text
