"""Convert legacy Office formats (.doc / .xls / .ppt) to their OOXML equivalents.

Legacy binary Office files have no reliable pure-Python parser, so they are
converted with a headless LibreOffice (``soffice``) invocation and the result
is fed back through the existing docx/xlsx/pptx extraction paths:

    .doc / .xls / .ppt → soffice --headless --convert-to → .docx / .xlsx / .pptx

LibreOffice is an *optional system dependency*: when no ``soffice`` binary is
found the conversion returns a structured error and callers degrade gracefully
(the file stays a binary asset with a ``parse_error``).
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
import threading
from functools import cache
from pathlib import Path

logger = logging.getLogger(__name__)

# legacy MIME → (source extension, target extension, target MIME)
_CONVERSION_TARGETS: dict[str, tuple[str, str, str]] = {
    "application/msword": (
        ".doc",
        "docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ),
    "application/vnd.ms-excel": (
        ".xls",
        "xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ),
    "application/vnd.ms-powerpoint": (
        ".ppt",
        "pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
}

LEGACY_OFFICE_MIME_TYPES = frozenset(_CONVERSION_TARGETS)

_SOFFICE_TIMEOUT_SECONDS = 120

# Non-PATH install locations checked after shutil.which().
_SOFFICE_FALLBACK_PATHS = (
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
    "/usr/lib/libreoffice/program/soffice",
    "/opt/libreoffice/program/soffice",
    "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
)

# One conversion at a time: each soffice launch is a full process spinning up
# ~200 MB; serializing keeps peak memory bounded alongside detector workloads.
_conversion_lock = threading.Lock()


@cache
def find_soffice() -> str | None:
    """Locate the LibreOffice binary, or None when it is not installed."""
    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path
    for candidate in _SOFFICE_FALLBACK_PATHS:
        if Path(candidate).exists():
            return candidate
    return None


def convert_legacy_office(
    file_bytes: bytes,
    mime_type: str,
) -> tuple[bytes | None, str, str | None]:
    """Convert legacy Office bytes to the modern OOXML equivalent.

    Returns ``(converted_bytes, target_mime_type, error)``; ``converted_bytes``
    is None when conversion is impossible (unsupported MIME, soffice missing,
    conversion failure) and ``error`` explains why.
    """
    normalized = (mime_type or "").split(";", 1)[0].strip().lower()
    target = _CONVERSION_TARGETS.get(normalized)
    if target is None:
        return None, "", f"Unsupported legacy Office MIME type: {mime_type}"
    source_ext, target_ext, target_mime = target

    soffice = find_soffice()
    if soffice is None:
        return (
            None,
            target_mime,
            "LibreOffice (soffice) not found; install LibreOffice to enable "
            ".doc/.xls/.ppt extraction",
        )

    try:
        with tempfile.TemporaryDirectory(prefix="classifyre-soffice-") as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / f"input{source_ext}"
            input_path.write_bytes(file_bytes)
            # A dedicated user profile per invocation avoids the default
            # profile's lock file, which otherwise makes concurrent (or
            # crashed) soffice runs fail with "another instance is running".
            profile_dir = temp_path / "profile"
            command = [
                soffice,
                "--headless",
                "--norestore",
                f"-env:UserInstallation={profile_dir.as_uri()}",
                "--convert-to",
                target_ext,
                "--outdir",
                str(temp_path),
                str(input_path),
            ]
            with _conversion_lock:
                completed = subprocess.run(
                    command,
                    capture_output=True,
                    timeout=_SOFFICE_TIMEOUT_SECONDS,
                    check=False,
                )
            output_path = temp_path / f"input.{target_ext}"
            if completed.returncode != 0 or not output_path.exists():
                stderr = completed.stderr.decode("utf-8", errors="replace").strip()
                return (
                    None,
                    target_mime,
                    f"LibreOffice conversion to {target_ext} failed "
                    f"(exit {completed.returncode}): {stderr[-500:] or 'no output produced'}",
                )
            converted = output_path.read_bytes()
            logger.info(
                "Converted legacy %s (%d bytes) to %s (%d bytes) via LibreOffice",
                normalized,
                len(file_bytes),
                target_ext,
                len(converted),
            )
            return converted, target_mime, None
    except subprocess.TimeoutExpired:
        return (
            None,
            target_mime,
            f"LibreOffice conversion timed out after {_SOFFICE_TIMEOUT_SECONDS}s",
        )
    except Exception as exc:
        return None, target_mime, f"LibreOffice conversion failed: {exc}"
