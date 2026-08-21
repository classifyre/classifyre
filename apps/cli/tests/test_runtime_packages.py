"""The advertised package list must match what the lock actually installs.

The notebook editor shows this list as fact -- "pdfplumber 0.11.10 is already
here" -- so a stale copy is worse than none: an author trusts a version that is
not what runs. The file is generated, and this fails the moment the checked-in
copy stops matching what the generator would produce now.
"""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

CLI_ROOT = Path(__file__).resolve().parents[1]
GENERATOR = CLI_ROOT / "scripts" / "generate_runtime_packages.py"


def _generator():
    spec = importlib.util.spec_from_file_location("generate_runtime_packages", GENERATOR)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_checked_in_manifest_matches_pyproject_and_lock() -> None:
    module = _generator()
    on_disk = json.loads(module.OUTPUT_PATH.read_text(encoding="utf-8"))
    assert on_disk == module.build(), (
        "notebook_runtime_packages.json is stale. Regenerate it with:\n"
        "  cd apps/cli && uv run python scripts/generate_runtime_packages.py"
    )


def test_every_dependency_group_has_a_verdict() -> None:
    # build() raises when pyproject grows a group this script has never judged,
    # so a new connector's dependencies cannot silently go unadvertised.
    module = _generator()
    module.build()  # would SystemExit on an unclassified group


def test_base_dependencies_are_always_available() -> None:
    module = _generator()
    packages = {entry["name"]: entry for entry in module.build()["packages"]}
    assert packages["requests"]["availability"] == "always"
    assert "group" not in packages["requests"]


def test_optional_groups_carry_the_group_that_installs_them() -> None:
    module = _generator()
    packages = {entry["name"]: entry for entry in module.build()["packages"]}
    assert packages["pdfplumber"]["availability"] == "on-demand"
    assert packages["pdfplumber"]["group"] == "file-processing"


def test_every_entry_has_a_resolved_version() -> None:
    # An empty version means the lock and pyproject disagree about a name --
    # which is exactly the drift this file exists to prevent.
    module = _generator()
    missing = [entry["name"] for entry in module.build()["packages"] if not entry["version"]]
    assert not missing, f"no locked version for: {missing}"


def test_the_ml_groups_are_not_advertised() -> None:
    # Importing one of these triggers a multi-gigabyte uv sync inside a run.
    module = _generator()
    names = {entry["name"] for entry in module.build()["packages"]}
    assert not names & {"torch", "transformers", "docling", "nudenet", "spacy"}


def test_import_names_are_recorded_where_they_differ() -> None:
    module = _generator()
    packages = {entry["name"]: entry for entry in module.build()["packages"]}
    assert packages["beautifulsoup4"]["modules"] == ["bs4"]
    assert packages["pillow"]["modules"] == ["PIL"]
    assert packages["python-docx"]["modules"] == ["docx"]
