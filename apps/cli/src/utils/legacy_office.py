"""Convert legacy Office formats (.doc / .xls / .ppt) to their OOXML equivalents.

Legacy binary Office files have no reliable pure-Python parser, so they are
converted with a headless LibreOffice (``soffice``) invocation and the result
is fed back through the existing docx/xlsx/pptx extraction paths:

    .doc / .xls / .ppt → soffice --headless --convert-to → .docx / .xlsx / .pptx

The CLI container image ships LibreOffice (the ``libreoffice-*-nogui`` Debian
packages, which install ``/usr/bin/soffice``), so conversion works out of the box
under Kubernetes. The desktop app deliberately does NOT bundle it — ~550 MB even
stripped, and slimming the upstream bundle breaks its code signature — so there
it is a system dependency the user installs.

When no binary is found the file is **not** quietly reported as empty: the error
from :func:`soffice_missing_error` propagates as an ENGINE_UNAVAILABLE text
extraction coverage failure, which fails that asset's text scan and tells the
user, per platform, how to install LibreOffice.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
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

# How to actually get LibreOffice, per platform. The desktop app does not bundle
# it, so this message is the entire remediation path a user gets — a generic
# "install LibreOffice" would leave them guessing which package to install.
_INSTALL_HINTS: dict[str, str] = {
    "darwin": "install it with `brew install --cask libreoffice`, or from libreoffice.org",
    "win32": "install it from https://www.libreoffice.org/download/",
    "linux": (
        "install it with "
        "`apt install libreoffice-writer libreoffice-calc libreoffice-impress` "
        "(or the equivalent for your distribution)"
    ),
}


def soffice_missing_error() -> str:
    """Actionable message for a deployment with no LibreOffice.

    The word "unavailable" is load-bearing: it is what makes iter_file_pages
    classify this as ENGINE_UNAVAILABLE rather than a per-document FAILED — the
    difference between "this install cannot read .doc at all" and "this one file
    is broken". test_legacy_office.py pins that mapping so the two cannot drift.
    """
    hint = _INSTALL_HINTS.get(sys.platform, "install LibreOffice")
    return (
        "LibreOffice is unavailable, so this .doc/.xls/.ppt file was NOT scanned. "
        f"To scan legacy Office documents, {hint} — "
        "or set CLASSIFYRE_SOFFICE_PATH to an existing soffice binary."
    )


# Explicit override, checked before anything else. The desktop app rebuilds a
# minimal PATH for the processes it spawns, so an installation it discovered
# itself is handed down through this variable rather than through PATH.
SOFFICE_PATH_ENV = "CLASSIFYRE_SOFFICE_PATH"

# Install locations to check when PATH comes up empty, keyed by sys.platform.
# macOS and Windows always need these: their installers drop the binary inside an
# app bundle / Program Files without touching PATH, and the packaged desktop app
# rebuilds a minimal PATH that cannot see either. Linux only needs them for an
# upstream tarball install — the distro packages (including the
# libreoffice-*-nogui ones in the CLI image) all land on /usr/bin/soffice.
_SOFFICE_FALLBACK_PATHS: dict[str, tuple[str, ...]] = {
    "darwin": ("/Applications/LibreOffice.app/Contents/MacOS/soffice",),
    "linux": (
        "/opt/libreoffice/program/soffice",
        "/usr/lib/libreoffice/program/soffice",
    ),
    "win32": (
        "C:\\Program Files\\LibreOffice\\program\\soffice.exe",
        "C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe",
    ),
}

# One conversion at a time: each soffice launch is a full process spinning up
# ~200 MB; serializing keeps peak memory bounded alongside detector workloads.
_conversion_lock = threading.Lock()


@cache
def find_soffice() -> str | None:
    """Locate the LibreOffice binary, or None when it is not installed.

    Resolution order, most explicit first:

    1. ``CLASSIFYRE_SOFFICE_PATH`` — an operator/desktop-supplied absolute path.
    2. ``PATH`` — the CLI container, Linux hosts, and dev shells.
    3. Platform install locations — macOS/Windows only (see the table above).

    Cached: the answer cannot change within a process. Tests that manipulate the
    environment must call ``find_soffice.cache_clear()``.
    """
    override = os.environ.get(SOFFICE_PATH_ENV, "").strip()
    if override:
        if Path(override).is_file():
            return override
        logger.warning(
            "%s=%s does not point at an existing file; falling back to PATH lookup",
            SOFFICE_PATH_ENV,
            override,
        )

    for name in ("soffice", "libreoffice"):
        path = shutil.which(name)
        if path:
            return path

    for candidate in _SOFFICE_FALLBACK_PATHS.get(sys.platform, ()):
        if Path(candidate).is_file():
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
        return None, target_mime, soffice_missing_error()

    try:
        with tempfile.TemporaryDirectory(prefix="classifyre-soffice-") as temp_dir:
            temp_path = Path(temp_dir)
            input_path = temp_path / f"input{source_ext}"
            input_path.write_bytes(file_bytes)
            # A dedicated user profile per invocation avoids the default
            # profile's lock file, which otherwise makes concurrent (or
            # crashed) soffice runs fail with "another instance is running".
            profile_dir = temp_path / "profile"
            # --headless alone still lets macOS surface the app (Dock icon /
            # brief window flash) on some LibreOffice builds; the extra flags
            # suppress the start center, first-run wizard, and lock checks so
            # conversions stay invisible.
            command = [
                soffice,
                "--headless",
                "--invisible",
                "--nologo",
                "--nodefault",
                "--nolockcheck",
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
