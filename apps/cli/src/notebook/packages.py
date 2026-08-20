"""Install the packages a notebook declares, before any of its code runs.

A connector for someone else's system usually needs that system's client
library, and shipping every possible client in the base image is not a plan. So
a notebook declares what it needs and the runtime installs it with uv.

Two things are deliberate here. The installer is invoked as an argv list, never
through a shell, and every name is re-validated against the schema's pattern
first -- the values arrive from a stored config, and a package name is the one
field that reaches a subprocess. And the install happens once per process,
before the first cell, rather than per cell: resolving dependencies on every Run
is what makes an interactive notebook feel broken.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger(__name__)

#: Mirrors NotebookPackage.name in all_input_sources.json.
NAME_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
#: Mirrors NotebookPackage.version.
VERSION_PATTERN = re.compile(r"^$|^(==|>=|<=|~=|!=|>|<).+$|^[0-9][A-Za-z0-9._*+!-]*$")

DEFAULT_TIMEOUT_SECONDS = 600
MAX_PACKAGES = 50

INSTALL_TIMEOUT_ENV = "CLASSIFYRE_NOTEBOOK_INSTALL_TIMEOUT_SECONDS"


class PackageSpecError(ValueError):
    """A declared package is not something we are willing to hand an installer."""


@dataclass
class InstallReport:
    requirements: list[str] = field(default_factory=list)
    installed: bool = False
    skipped_reason: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "requirements": self.requirements,
            "installed": self.installed,
            "skippedReason": self.skipped_reason,
            "error": self.error,
        }


def to_requirement(package: Any) -> str:
    """Turn one declared package into a requirement string.

    Re-validates rather than trusting the stored config: this value ends up in
    an installer's argv, and the schema that produced it is not the thing
    running here.
    """
    if isinstance(package, dict):
        name = str(package.get("name", "")).strip()
        version = str(package.get("version") or "").strip()
    else:
        name = str(getattr(package, "name", "")).strip()
        version = str(getattr(package, "version", "") or "").strip()

    if not NAME_PATTERN.match(name):
        raise PackageSpecError(
            f"{name!r} is not a valid package name. Use letters, digits, "
            "'.', '-' or '_', starting with a letter or digit."
        )
    if not VERSION_PATTERN.match(version):
        raise PackageSpecError(
            f"{version!r} is not a valid version for {name!r}. Use '2.2.0', "
            "'>=2.0', '~=1.4', or leave it empty for the latest."
        )

    if not version:
        return name
    # A bare version means "exactly this one"; anything starting with an
    # operator is already a specifier.
    return f"{name}{version}" if version[0] in "=<>~!" else f"{name}=={version}"


def requirements_from(packages: Any) -> list[str]:
    """Validate a declared package list into requirement strings."""
    if not packages:
        return []
    if len(packages) > MAX_PACKAGES:
        raise PackageSpecError(
            f"A notebook may declare at most {MAX_PACKAGES} packages, got {len(packages)}."
        )
    seen: set[str] = set()
    requirements: list[str] = []
    for package in packages:
        requirement = to_requirement(package)
        name = re.split(r"[=<>~!]", requirement, maxsplit=1)[0].lower()
        if name in seen:
            raise PackageSpecError(f"{name!r} is declared more than once.")
        seen.add(name)
        requirements.append(requirement)
    return requirements


def _timeout() -> int:
    try:
        return int(os.environ.get(INSTALL_TIMEOUT_ENV) or DEFAULT_TIMEOUT_SECONDS)
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS


def install(packages: Any) -> InstallReport:
    """Install the declared packages into the running interpreter's environment."""
    try:
        requirements = requirements_from(packages)
    except PackageSpecError as exc:
        return InstallReport(error=str(exc))

    report = InstallReport(requirements=requirements)
    if not requirements:
        return report

    uv = shutil.which("uv")
    if not uv:
        report.skipped_reason = (
            "uv is not on PATH, so declared packages were not installed. "
            "They must already be present in the image."
        )
        logger.warning(report.skipped_reason)
        return report

    # --python pins the target: uv would otherwise resolve an environment of its
    # own choosing, and the packages have to land where the cells will look.
    command = [uv, "pip", "install", "--python", sys.executable, *requirements]
    logger.info("Installing notebook packages: %s", ", ".join(requirements))

    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=_timeout(),
            check=False,
        )
    except subprocess.TimeoutExpired:
        report.error = f"Installing packages took longer than {_timeout()}s."
        return report
    except OSError as exc:
        report.error = f"Could not run uv: {exc}"
        return report

    if completed.returncode != 0:
        # The installer's own message names the package that failed, which is
        # the only useful thing to show the author.
        detail = (completed.stderr or completed.stdout or "").strip()
        report.error = detail[-2000:] or f"uv exited with code {completed.returncode}"
        return report

    report.installed = True
    return report
