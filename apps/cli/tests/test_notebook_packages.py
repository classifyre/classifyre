"""Validating and installing the packages a notebook declares.

Package names reach a subprocess argv, so the validation here is a boundary,
not a convenience: everything else in the module assumes it already ran.
"""

from __future__ import annotations

import pytest

from src.notebook.packages import (
    InstallReport,
    PackageSpecError,
    install,
    requirements_from,
    to_requirement,
)


@pytest.mark.parametrize(
    ("package", "expected"),
    [
        ({"name": "pandas"}, "pandas"),
        ({"name": "pandas", "version": ""}, "pandas"),
        # A bare version means "exactly this one".
        ({"name": "pandas", "version": "2.2.0"}, "pandas==2.2.0"),
        ({"name": "pandas", "version": ">=2.0"}, "pandas>=2.0"),
        ({"name": "pandas", "version": "~=1.4"}, "pandas~=1.4"),
        ({"name": "pandas", "version": "!=2.1.0"}, "pandas!=2.1.0"),
        ({"name": "google-cloud-storage"}, "google-cloud-storage"),
        ({"name": "ruamel.yaml"}, "ruamel.yaml"),
    ],
)
def test_valid_packages_become_requirements(package, expected) -> None:
    assert to_requirement(package) == expected


@pytest.mark.parametrize(
    "name",
    [
        "",
        "-leading-hyphen",
        ".leading-dot",
        "has space",
        "semi;colon",
        "amp&ersand",
        "pipe|d",
        "back`tick",
        "dollar$sign",
        "new\nline",
        "--index-url",
        "a" * 65,
    ],
)
def test_a_name_that_could_reach_an_installer_is_rejected(name: str) -> None:
    # These are handed to a package installer's argv. Even without a shell, an
    # argument-looking name like "--index-url" must never get through.
    with pytest.raises(PackageSpecError):
        to_requirement({"name": name})


@pytest.mark.parametrize("version", ["; rm -rf /", "$(id)", "not a version", "--force"])
def test_a_bad_version_is_rejected(version: str) -> None:
    with pytest.raises(PackageSpecError):
        to_requirement({"name": "pandas", "version": version})


def test_duplicate_packages_are_rejected() -> None:
    with pytest.raises(PackageSpecError, match="more than once"):
        requirements_from([{"name": "pandas"}, {"name": "Pandas", "version": "2.0"}])


def test_too_many_packages_are_rejected() -> None:
    with pytest.raises(PackageSpecError, match="at most"):
        requirements_from([{"name": f"pkg-{index}"} for index in range(51)])


def test_no_packages_is_not_an_install() -> None:
    report = install([])
    assert report == InstallReport()
    assert report.installed is False


def test_a_bad_spec_is_reported_rather_than_raised() -> None:
    # The caller turns this into a cell error naming the package; raising here
    # would surface as an unexplained crash instead.
    report = install([{"name": "--index-url"}])
    assert report.error is not None
    assert report.installed is False


def test_install_invokes_uv_without_a_shell(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class Completed:
        returncode = 0
        stdout = ""
        stderr = ""

    def fake_run(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return Completed()

    monkeypatch.setattr("src.notebook.packages.shutil.which", lambda _: "/usr/bin/uv")
    monkeypatch.setattr("src.notebook.packages.subprocess.run", fake_run)

    report = install([{"name": "pandas", "version": ">=2.0"}, {"name": "httpx"}])

    assert report.installed is True
    command = captured["command"]
    assert isinstance(command, list), "argv list, never a shell string"
    assert command[:3] == ["/usr/bin/uv", "pip", "install"]
    assert "pandas>=2.0" in command and "httpx" in command
    assert "shell" not in captured["kwargs"]


def test_a_failed_install_reports_the_installers_own_message(monkeypatch) -> None:
    class Completed:
        returncode = 1
        stdout = ""
        stderr = "No solution found: pandas==99.0.0 does not exist"

    monkeypatch.setattr("src.notebook.packages.shutil.which", lambda _: "/usr/bin/uv")
    monkeypatch.setattr(
        "src.notebook.packages.subprocess.run",
        lambda *_args, **_kwargs: Completed(),
    )

    report = install([{"name": "pandas", "version": "99.0.0"}])
    assert report.installed is False
    assert "does not exist" in (report.error or "")


def test_a_missing_uv_is_a_warning_not_a_failure(monkeypatch) -> None:
    # The image may already carry the packages; refusing to run would be worse
    # than trying and letting the import fail with a real message.
    monkeypatch.setattr("src.notebook.packages.shutil.which", lambda _: None)
    report = install([{"name": "pandas"}])
    assert report.error is None
    assert report.installed is False
    assert "uv is not on PATH" in (report.skipped_reason or "")
