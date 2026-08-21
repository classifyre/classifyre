"""The templates an author starts from have to actually run.

A template is the first code most people will scan with, and it teaches the SDK
by example -- so a broken one is worse than a missing one. These run each
shipped template through the real CUSTOM source, in a real child process,
against real files.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from src.notebook.contract import validate_notebook
from src.notebook.scaffold import _custom_examples
from src.sources import get_source
from src.sources.custom.source import CustomSource


def template(name: str) -> list[dict[str, Any]]:
    for example in _custom_examples():
        if example.get("name") == name:
            return example["config"]["required"]["notebook"]["cells"]
    raise AssertionError(f"no CUSTOM template named {name!r}")


def recipe_for(name: str, **optional: Any) -> dict[str, Any]:
    example = next(item for item in _custom_examples() if item.get("name") == name)
    config = json.loads(json.dumps(example["config"]))
    config["optional"] = {**config.get("optional", {}), **optional}
    return config


def build(request: pytest.FixtureRequest, config: dict[str, Any]) -> CustomSource:
    instance = get_source(config, source_id="src-1", runner_id="run-1")
    request.addfinalizer(instance.cleanup)
    return instance  # type: ignore[return-value]


def collect(instance: CustomSource) -> list[Any]:
    async def run() -> list[Any]:
        gathered: list[Any] = []
        async for batch in instance.extract_raw():
            gathered.extend(batch)
        return gathered

    return asyncio.run(run())


@pytest.mark.parametrize(
    "name",
    [example["name"] for example in _custom_examples()],
)
def test_every_template_satisfies_the_contract(name: str) -> None:
    report = validate_notebook(template(name))
    assert report.ok, f"{name}: {report.violations}"


def test_the_linked_assets_template_produces_a_graph(
    request: pytest.FixtureRequest,
) -> None:
    instance = build(request, recipe_for("Linked assets"))
    assets = collect(instance)

    by_name = {asset.name: asset for asset in assets}
    assert "Refund request" in by_name
    parent = by_name["Refund request"]

    # The notebook links by its own ids; the adapter turns them into hashes, so
    # what reaches the graph is resolvable both ways.
    assert parent.links
    hashes = {asset.hash for asset in assets}
    assert set(parent.links) <= hashes


def test_the_uploaded_files_template_reads_ctx_files(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_download(_session, _api_url, _source_id, destination: Path) -> int:
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "contacts.csv").write_text(
            "name,email\nAda,ada@example.com\n", encoding="utf-8"
        )
        return 1

    monkeypatch.setattr("src.sources.custom.source.download_source_files", fake_download)

    instance = build(request, recipe_for("Read files uploaded to this source"))
    assert instance.test_connection()["status"] == "SUCCESS"

    assets = collect(instance)
    assert [asset.name for asset in assets] == ["contacts.csv"]
    _, text = asyncio.run(instance.fetch_content(assets[0].hash))
    assert "ada@example.com" in text


def test_the_file_parser_template_reads_any_format(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    def fake_download(_session, _api_url, _source_id, destination: Path) -> int:
        destination.mkdir(parents=True, exist_ok=True)
        (destination / "record.json").write_text(
            json.dumps({"customer": "ACME"}), encoding="utf-8"
        )
        (destination / "notes.txt").write_text("plain notes", encoding="utf-8")
        return 2

    monkeypatch.setattr("src.sources.custom.source.download_source_files", fake_download)

    instance = build(request, recipe_for("Parse files of any format"))
    assets = collect(instance)
    assert {asset.name for asset in assets} == {"record.json", "notes.txt"}

    by_name = {asset.name: asset for asset in assets}
    _, text = asyncio.run(instance.fetch_content(by_name["record.json"].hash))
    assert "ACME" in text
    # content_bytes came through too, so the binary detectors have the real file.
    raw, _mime = asyncio.run(instance.fetch_content_bytes(by_name["notes.txt"].hash))
    assert raw == b"plain notes"


def test_the_local_folder_template_walks_a_real_folder(
    request: pytest.FixtureRequest, tmp_path: Path
) -> None:
    root = tmp_path / "dumps"
    (root / "nested").mkdir(parents=True)
    (root / "top.txt").write_text("top level", encoding="utf-8")
    (root / "nested" / "inner.json").write_text('{"k": "v"}', encoding="utf-8")
    (root / "ignored.bin").write_bytes(b"\x00\x01")

    config = recipe_for(
        "Read a folder on this machine (desktop)",
        local_folders=[{"name": "dumps", "path": str(root)}],
    )
    instance = build(request, config)
    assert instance.test_connection()["status"] == "SUCCESS"

    assets = collect(instance)
    # Ids are relative to the folder, so moving it does not orphan every asset.
    assert {asset.name for asset in assets} == {"top.txt", "inner.json"}
