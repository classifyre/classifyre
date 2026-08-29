"""The CUSTOM source: notebook Assets in, scan results out.

The adapter owns everything a connector author should not have to: hashes,
checksums, link resolution, metadata validation, sampling windows, and keeping
notebook code away from this process's credentials.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from src.notebook.contract import NotebookContractError
from src.sources import get_source
from src.sources.asset_metadata import is_open_kind, validate_metadata
from src.sources.custom.env import ALLOWED_ENV_KEYS, scrubbed_environment
from src.sources.custom.source import CustomSource
from src.utils.hashing import hash_id

SIMPLE_NOTEBOOK = """from classifyre import Asset, ctx


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": f"Reached {ctx.var('api_base')}"}


def extract():
    for index in range(1, 6):
        yield Asset(
            id=f"rec-{index}",
            name=f"Record {index}",
            url=f"{ctx.var('api_base')}/records/{index}",
            content=f"Body of record {index}",
            kind="record",
            metadata={"collection": "records"},
            links=[f"rec-{index + 1}"] if index < 5 else [],
        )
"""


def counting_notebook(total: int) -> str:
    return SIMPLE_NOTEBOOK.replace("range(1, 6)", f"range(1, {total + 1})")


def build_recipe(notebook: str = SIMPLE_NOTEBOOK, **overrides: Any) -> dict[str, Any]:
    recipe: dict[str, Any] = {
        "type": "CUSTOM",
        "required": {
            "notebook": {
                "revision": 1,
                "cells": [{"id": "nb", "type": "code", "source": notebook}],
            }
        },
        "masked": {"secrets": {"api_token": "tok-abcdef-123456"}},
        "optional": {"variables": {"api_base": "https://api.example.com"}},
        "sampling": {"strategy": "ALL", "rows_per_page": 100},
    }
    recipe.update(overrides)
    return recipe


@pytest.fixture
def source(request: pytest.FixtureRequest):
    def build(recipe: dict[str, Any] | None = None) -> CustomSource:
        instance = get_source(recipe or build_recipe(), source_id="src-1", runner_id="run-1")
        request.addfinalizer(instance.cleanup)
        return instance  # type: ignore[return-value]

    return build


def collect(instance: CustomSource) -> list[Any]:
    async def run() -> list[Any]:
        gathered: list[Any] = []
        async for batch in instance.extract_raw():
            gathered.extend(batch)
        return gathered

    return asyncio.run(run())


# -- registration ------------------------------------------------------------


def test_registers_under_the_custom_source_type(source) -> None:
    assert isinstance(source(), CustomSource)
    assert CustomSource.source_type == "custom"


# -- connection --------------------------------------------------------------


def test_test_connection_reports_the_notebook_verdict(source) -> None:
    result = source().test_connection()
    assert result["status"] == "SUCCESS"
    assert "https://api.example.com" in result["message"]
    assert result["source_type"] == "CUSTOM"


def test_test_connection_fails_cleanly_when_the_notebook_raises(source) -> None:
    notebook = SIMPLE_NOTEBOOK.replace(
        'return {"status": "SUCCESS", "message": f"Reached {ctx.var(\'api_base\')}"}',
        'raise RuntimeError("host unreachable")',
    )
    result = source(build_recipe(notebook)).test_connection()
    assert result["status"] == "FAILURE"
    assert "host unreachable" in result["message"]


def test_a_notebook_missing_extract_is_rejected_before_anything_runs(source) -> None:
    notebook = 'def test_connection():\n    return {"status": "SUCCESS"}\n'
    instance = source(build_recipe(notebook))
    result = instance.test_connection()
    assert result["status"] == "FAILURE"
    assert "extract" in result["message"]

    with pytest.raises(NotebookContractError):
        collect(instance)


# -- extraction --------------------------------------------------------------


def test_yields_one_scan_result_per_asset(source) -> None:
    assets = collect(source())
    assert len(assets) == 5
    assert [asset.name for asset in assets[:2]] == ["Record 1", "Record 2"]


def test_hashes_are_stable_and_derived_from_the_notebook_id(source) -> None:
    assets = collect(source())
    assert assets[0].hash == hash_id("custom", "rec-1")
    # Same notebook, new instance: the same asset must keep its identity or
    # findings and history detach from it on the next run.
    assert collect(source())[0].hash == assets[0].hash


def test_notebook_links_are_resolved_to_asset_hashes(source) -> None:
    assets = collect(source())
    by_hash = {asset.hash: asset for asset in assets}
    assert assets[0].links == [assets[1].hash]
    assert assets[0].links[0] in by_hash
    assert assets[-1].links == []


def test_asset_kind_and_metadata_reach_the_scan_result(source) -> None:
    asset = collect(source())[0]
    assert asset.asset_kind == "record"
    assert asset.metadata["collection"] == "records"
    # The adapter fills in the notebook's own id so an asset is traceable back
    # to the system it came from without the author remembering to.
    assert asset.metadata["external_id"] == "rec-1"


def test_unknown_asset_kind_falls_back_instead_of_failing_the_scan(source) -> None:
    notebook = SIMPLE_NOTEBOOK.replace('kind="record"', 'kind="widget"')
    assets = collect(source(build_recipe(notebook)))
    assert assets[0].asset_kind == "record"


def test_asset_without_a_url_still_gets_a_location(source) -> None:
    notebook = SIMPLE_NOTEBOOK.replace("url=f\"{ctx.var('api_base')}/records/{index}\",", "")
    assets = collect(source(build_recipe(notebook)))
    assert assets[0].external_url.startswith("custom://")


def test_checksum_changes_when_content_changes(source) -> None:
    first = collect(source())[0]
    changed = SIMPLE_NOTEBOOK.replace("Body of record", "Revised body of record")
    second = collect(source(build_recipe(changed)))[0]
    assert first.hash == second.hash
    assert first.checksum != second.checksum


# -- tags --------------------------------------------------------------------


TAGGING_NOTEBOOK = """from classifyre import Asset


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": "Ready."}


def extract():
    yield Asset(
        id="tbl-1",
        name="transactions",
        content="card_last4,amount",
        kind="table",
        tags={"cardholder_data": "primary-account-numbers"},
    )
"""


def test_tags_reach_the_source_from_the_notebook(source) -> None:
    instance = source(build_recipe(TAGGING_NOTEBOOK))
    asset = collect(instance)[0]
    assert instance.asset_tags(asset.hash) == {"cardholder_data": "primary-account-numbers"}


def test_an_untagged_asset_reports_no_tags(source) -> None:
    instance = source()
    asset = collect(instance)[0]
    assert instance.asset_tags(asset.hash) == {}


def test_checksum_changes_when_only_a_tag_changes(source) -> None:
    # Without tags in the checksum the scan cache skips the asset and the new
    # tag never becomes a finding -- the whole feature silently stops working.
    first = collect(source(build_recipe(TAGGING_NOTEBOOK)))[0]
    changed = TAGGING_NOTEBOOK.replace("primary-account-numbers", "tokenized-pan")
    second = collect(source(build_recipe(changed)))[0]
    assert first.hash == second.hash
    assert first.checksum != second.checksum


# -- content -----------------------------------------------------------------


def test_content_survives_between_discovery_and_detection(source) -> None:
    instance = source()
    assets = collect(instance)
    fetched = asyncio.run(instance.fetch_content(assets[0].hash))
    assert fetched is not None
    assert fetched[1] == "Body of record 1"


def test_evicting_an_asset_releases_its_cached_content(source) -> None:
    instance = source()
    assets = collect(instance)
    instance.evict_asset_cache(assets[0].hash)
    assert asyncio.run(instance.fetch_content(assets[0].hash)) is None


# -- sampling ----------------------------------------------------------------


def test_all_strategy_reads_every_asset(source) -> None:
    assert len(collect(source())) == 5


def test_latest_strategy_is_bounded_by_the_page_size(source) -> None:
    recipe = build_recipe(counting_notebook(25))
    recipe["sampling"] = {"strategy": "LATEST", "rows_per_page": 10}
    assert len(collect(source(recipe))) == 10


def test_max_assets_limit_is_enforced(source) -> None:
    recipe = build_recipe()
    recipe["optional"]["limits"] = {"max_assets": 3}
    assert len(collect(source(recipe))) == 3


def test_automatic_strategy_pages_across_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    recipe = build_recipe(counting_notebook(25))
    recipe["sampling"] = {"strategy": "AUTOMATIC", "rows_per_page": 10}

    first = get_source(dict(recipe), source_id="s", runner_id="r")
    try:
        names = [asset.name for asset in collect(first)]
        assert names[0] == "Record 1"
        assert len(names) == 10
        cursor = first.current_sampling_cursor()
    finally:
        first.cleanup()
    assert cursor == {"assets": 10}

    # The API carries the cursor to the next run through the environment,
    # because the recipe itself forbids extra keys.
    import base64
    import json

    monkeypatch.setenv(
        CustomSource.SAMPLING_CURSOR_ENV,
        base64.b64encode(json.dumps(cursor).encode()).decode(),
    )
    second = get_source(dict(recipe), source_id="s", runner_id="r")
    try:
        names = [asset.name for asset in collect(second)]
        assert names[0] == "Record 11"
        assert len(names) == 10
    finally:
        second.cleanup()


def test_automatic_cursor_wraps_when_the_source_is_exhausted() -> None:
    recipe = build_recipe()  # 5 assets, window of 10
    recipe["sampling"] = {"strategy": "AUTOMATIC", "rows_per_page": 10}
    instance = get_source(dict(recipe), source_id="s", runner_id="r")
    try:
        collect(instance)
        # Fewer assets than the window means the end was reached: the next run
        # should start over rather than stall on a cursor past the end.
        assert instance.current_sampling_cursor() == {"assets": 0}
    finally:
        instance.cleanup()


# -- isolation ---------------------------------------------------------------


def test_notebook_environment_excludes_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    for key, value in {
        "DATABASE_URL": "postgres://user:pw@host/ns_x",
        "CLASSIFYRE_INTERNAL_KEY": "internal-key",
        "CLASSIFYRE_MASKED_CONFIG_KEY": "base64:AAAA",
        "OPENAI_API_KEY": "sk-nope",
        "AWS_SECRET_ACCESS_KEY": "aws-nope",
    }.items():
        monkeypatch.setenv(key, value)

    env = scrubbed_environment()
    for key in (
        "DATABASE_URL",
        "CLASSIFYRE_INTERNAL_KEY",
        "CLASSIFYRE_MASKED_CONFIG_KEY",
        "OPENAI_API_KEY",
        "AWS_SECRET_ACCESS_KEY",
    ):
        assert key not in env, f"{key} must never reach notebook code"
    assert set(env) <= ALLOWED_ENV_KEYS


def test_notebook_cannot_read_the_parent_credentials(
    source, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgres://user:pw@host/ns_x")
    monkeypatch.setenv("CLASSIFYRE_INTERNAL_KEY", "internal-key")

    notebook = """import os
from classifyre import Asset


def test_connection() -> dict:
    leaked = [k for k in ("DATABASE_URL", "CLASSIFYRE_INTERNAL_KEY") if os.environ.get(k)]
    return {"status": "SUCCESS", "message": f"leaked={leaked}"}


def extract():
    yield Asset(id="1", name="env", content="x")
"""
    result = source(build_recipe(notebook)).test_connection()
    assert result["message"] == "leaked=[]"


def test_allowlist_permits_tls_and_proxy_settings() -> None:
    # Dropping these looks like a broken connector rather than a policy choice.
    assert {"SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "HTTPS_PROXY"} <= ALLOWED_ENV_KEYS


# -- metadata catalog --------------------------------------------------------


def test_custom_asset_kinds_are_open() -> None:
    # A notebook's metadata keys cannot be known when the schema is written.
    assert is_open_kind("custom", "record")
    assert not is_open_kind("wordpress", "post")


def test_open_kind_accepts_undeclared_keys() -> None:
    emitted = {"anything_the_notebook_chose": 1, "external_id": "x"}
    assert validate_metadata("custom", "record", emitted) == emitted


def test_closed_kind_still_rejects_undeclared_keys() -> None:
    from src.sources.asset_metadata import AssetMetadataContractError

    with pytest.raises(AssetMetadataContractError):
        validate_metadata("wordpress", "post", {"not_a_declared_key": 1})


def test_checksum_covers_content_past_any_truncation_point(source) -> None:
    # An early version hashed only the first 4 KB, so an edit further in went
    # unnoticed whenever the length happened to match -- the asset stayed stale
    # across every future scan.
    filler = "x" * 5000
    base = SIMPLE_NOTEBOOK.replace(
        'content=f"Body of record {index}"',
        f'content="{filler}" + "A"',
    )
    changed = SIMPLE_NOTEBOOK.replace(
        'content=f"Body of record {index}"',
        f'content="{filler}" + "B"',
    )
    first = collect(source(build_recipe(base)))[0]
    second = collect(source(build_recipe(changed)))[0]

    assert first.hash == second.hash
    assert first.checksum != second.checksum


def test_checksum_is_stable_for_unchanged_content(source) -> None:
    first = collect(source())[0]
    second = collect(source())[0]
    assert first.checksum == second.checksum


def test_random_strategy_samples_the_whole_stream_not_its_head(source) -> None:
    # Taking the first N would return the same head every run, which is the one
    # outcome RANDOM exists to avoid.
    recipe = build_recipe(counting_notebook(200))
    recipe["sampling"] = {"strategy": "RANDOM", "rows_per_page": 10}

    names = {tuple(asset.name for asset in collect(source(recipe))) for _ in range(3)}
    assert all(len(sample) == 10 for sample in names)

    drawn = {name for sample in names for name in sample}
    # A head-taking implementation could only ever produce Records 1..10.
    assert any(int(name.split()[1]) > 10 for name in drawn), drawn


def test_random_strategy_reads_beyond_the_window(source) -> None:
    instance = source(
        {
            **build_recipe(counting_notebook(50)),
            "sampling": {"strategy": "RANDOM", "rows_per_page": 10},
        }
    )
    collect(instance)
    # `seen` proves the stream was drained, which is what makes the draw fair.
    assert instance.get_stats()["seen"] == 50
    assert instance.get_stats()["produced"] == 10


def test_latest_strategy_preserves_the_notebook_order(source) -> None:
    # A stream carries no recency of its own, so "latest" is whatever the
    # notebook yields first -- documented in the scaffold, asserted here.
    recipe = build_recipe(counting_notebook(25))
    recipe["sampling"] = {"strategy": "LATEST", "rows_per_page": 10}
    names = [asset.name for asset in collect(source(recipe))]
    assert names == [f"Record {index}" for index in range(1, 11)]


def test_notebook_can_read_the_run_strategy_and_limit(source) -> None:
    # This is how a notebook samples at its own source instead of yielding
    # everything for the runtime to discard.
    notebook = """from classifyre import Asset, ctx


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": f"{ctx.strategy}/{ctx.limit}"}


def extract():
    yield Asset(id="1", name=f"{ctx.strategy}:{ctx.limit}", content="x")
"""
    recipe = build_recipe(notebook)
    recipe["sampling"] = {"strategy": "LATEST", "rows_per_page": 25}
    assert source(recipe).test_connection()["message"] == "LATEST/25"

    all_recipe = build_recipe(notebook)
    all_recipe["sampling"] = {"strategy": "ALL", "rows_per_page": 25}
    # Under ALL there is no limit to push down.
    assert source(all_recipe).test_connection()["message"] == "ALL/None"


# -- binary content ----------------------------------------------------------

PNG_PIXEL_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

BYTES_NOTEBOOK = f'''import base64

from classifyre import Asset, ctx


def test_connection() -> dict:
    return {{"status": "SUCCESS", "message": "ok"}}


def extract():
    yield Asset(
        id="pixel",
        name="pixel.png",
        url="https://example.com/pixel.png",
        content_bytes=base64.b64decode("{PNG_PIXEL_B64}"),
        mime_type="image/png",
        kind="file",
    )
'''


def test_notebook_can_emit_binary_content(source) -> None:
    # Without this a connector that fetches PDFs or images has nothing to hand
    # the file and image detectors.
    instance = source(build_recipe(BYTES_NOTEBOOK))
    asset = collect(instance)[0]

    fetched = asyncio.run(instance.fetch_content_bytes(asset.hash))
    assert fetched is not None
    raw, mime = fetched
    assert raw.startswith(b"\x89PNG")
    assert mime == "image/png"


def test_binary_asset_routes_to_the_image_detectors(source) -> None:
    # asset_type is what routes detectors, so an image must not arrive as TXT.
    asset = collect(source(build_recipe(BYTES_NOTEBOOK)))[0]
    assert str(asset.asset_type) == "IMAGE"


def test_binary_asset_gets_normalized_file_metadata(source) -> None:
    # The same keys every other file source emits, without the author knowing
    # they exist.
    asset = collect(source(build_recipe(BYTES_NOTEBOOK)))[0]
    assert asset.metadata["mime_type"] == "image/png"
    assert asset.metadata["size_bytes"] > 0


def test_evicting_a_binary_asset_releases_its_bytes(source) -> None:
    instance = source(build_recipe(BYTES_NOTEBOOK))
    asset = collect(instance)[0]
    instance.evict_asset_cache(asset.hash)
    assert asyncio.run(instance.fetch_content_bytes(asset.hash)) is None


def test_text_only_notebook_has_no_binary_content(source) -> None:
    instance = source()
    asset = collect(instance)[0]
    assert asyncio.run(instance.fetch_content_bytes(asset.hash)) is None


# -- sampling without notebook cooperation -----------------------------------
#
# The question these answer: does a strategy do anything at all if the notebook
# never mentions it?

IGNORES_CTX = """from classifyre import Asset


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": "ok"}


def extract():
    for index in range(1, 51):
        yield Asset(id=str(index), name=f"Record {index}", content=f"body {index}")
"""


def _sampled(source, strategy: str, page: int = 10):
    recipe = build_recipe(IGNORES_CTX)
    recipe["sampling"] = {"strategy": strategy, "rows_per_page": page}
    instance = source(recipe)
    return [asset.name for asset in collect(instance)], instance


def test_all_ingests_everything_without_cooperation(source) -> None:
    names, _ = _sampled(source, "ALL")
    assert len(names) == 50


def test_latest_is_bounded_without_cooperation(source) -> None:
    names, instance = _sampled(source, "LATEST")
    assert len(names) == 10
    # And the notebook is stopped early rather than drained.
    assert instance.get_stats()["seen"] == 10


def test_random_is_bounded_and_actually_random_without_cooperation(source) -> None:
    names, instance = _sampled(source, "RANDOM")
    assert len(names) == 10
    # Drained, which is what makes the draw uniform.
    assert instance.get_stats()["seen"] == 50


def test_automatic_pages_without_cooperation(monkeypatch) -> None:
    import base64
    import json

    recipe = build_recipe(IGNORES_CTX)
    recipe["sampling"] = {"strategy": "AUTOMATIC", "rows_per_page": 10}

    cursor: dict | None = None
    seen_first: list[str] = []
    for _ in range(3):
        if cursor is not None:
            monkeypatch.setenv(
                CustomSource.SAMPLING_CURSOR_ENV,
                base64.b64encode(json.dumps(cursor).encode()).decode(),
            )
        instance = get_source(dict(recipe), source_id="s", runner_id="r")
        try:
            names = [asset.name for asset in collect(instance)]
            cursor = instance.current_sampling_cursor()
        finally:
            instance.cleanup()
        seen_first.append(names[0])

    # Each run covers new ground, with no help from the notebook.
    assert seen_first == ["Record 1", "Record 11", "Record 21"]


def test_a_notebook_can_take_over_paging_from_the_runtime(monkeypatch) -> None:
    # Without this, run N makes extract() produce N*page items to deliver page
    # of them -- fine for a list in memory, quadratic when each item is a
    # request. Reading ctx.offset hands the skipping to the notebook.
    import base64
    import json

    notebook = """from classifyre import Asset, ctx


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": "ok"}


def extract():
    start = ctx.offset
    for index in range(start + 1, start + (ctx.limit or 10) + 1):
        yield Asset(id=str(index), name=f"Record {index}", content="x")
"""
    recipe = build_recipe(notebook)
    recipe["sampling"] = {"strategy": "AUTOMATIC", "rows_per_page": 10}

    monkeypatch.setenv(
        CustomSource.SAMPLING_CURSOR_ENV,
        base64.b64encode(json.dumps({"assets": 20}).encode()).decode(),
    )
    instance = get_source(dict(recipe), source_id="s", runner_id="r")
    try:
        names = [asset.name for asset in collect(instance)]
        stats = instance.get_stats()
    finally:
        instance.cleanup()

    assert names[0] == "Record 21"
    assert len(names) == 10
    # The notebook produced exactly what was wanted: nothing was generated and
    # thrown away, and the runtime did not skip on top of it.
    assert stats["seen"] == 10


# -- files a notebook can reach ----------------------------------------------

FILES_NOTEBOOK = """from classifyre import Asset, ctx


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": f"{len(ctx.files)}: " + ",".join(f.name for f in ctx.files)}


def extract():
    for file in ctx.files:
        parsed = file.parse()
        yield Asset(
            id=file.name,
            name=file.name,
            kind="file",
            content=parsed.text,
            content_bytes=file.read_bytes(),
        )
"""


@pytest.fixture
def uploaded_files(monkeypatch: pytest.MonkeyPatch, tmp_path):
    """Stand in for the API's uploaded-file endpoints.

    The download itself is not what these tests are about -- what matters is
    that the *parent* does it and the child only ever sees a directory.
    """
    staged = tmp_path / "uploads"
    staged.mkdir()
    (staged / "notes.txt").write_text("customer email ada@example.com", encoding="utf-8")
    (staged / "rows.csv").write_text("name,email\nAda,ada@example.com\n", encoding="utf-8")

    def fake_download(_session, _api_url, _source_id, destination) -> int:
        destination.mkdir(parents=True, exist_ok=True)
        for path in staged.iterdir():
            (destination / path.name).write_bytes(path.read_bytes())
        return 2

    monkeypatch.setattr("src.sources.custom.source.download_source_files", fake_download)
    return staged


@pytest.mark.usefixtures("uploaded_files")
def test_uploaded_files_reach_the_notebook_as_ctx_files(source) -> None:
    result = source(build_recipe(FILES_NOTEBOOK)).test_connection()
    assert result["status"] == "SUCCESS"
    assert result["message"] == "2: notes.txt,rows.csv"


@pytest.mark.usefixtures("uploaded_files")
def test_uploaded_files_are_parsed_into_asset_content(source) -> None:
    instance = source(build_recipe(FILES_NOTEBOOK))
    assets = collect(instance)
    by_name = {asset.name: asset for asset in assets}
    assert set(by_name) == {"notes.txt", "rows.csv"}

    # Parsed through the same extractor every built-in file source uses, so the
    # notebook wrote no format handling of its own.
    _, text = asyncio.run(instance.fetch_content(by_name["rows.csv"].hash))
    assert "ada@example.com" in text

    # And the bytes came through, so the binary/image detectors have something.
    raw, _mime = asyncio.run(instance.fetch_content_bytes(by_name["notes.txt"].hash))
    assert raw == b"customer email ada@example.com"


@pytest.mark.usefixtures("uploaded_files")
def test_the_notebook_process_never_gets_the_api_url(
    source, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The parent downloads with this; handing it to the child would undo the
    # reason the child process exists.
    monkeypatch.setenv("CLASSIFYRE_OUTPUT_REST_URL", "http://api.internal:8000/ns")
    notebook = """import os
from classifyre import Asset, ctx


def test_connection() -> dict:
    leaked = os.environ.get("CLASSIFYRE_OUTPUT_REST_URL", "")
    return {"status": "SUCCESS", "message": f"files={len(ctx.files)} url={leaked!r}"}


def extract():
    yield Asset(id="1", content="x")
"""
    result = source(build_recipe(notebook)).test_connection()
    assert result["message"] == "files=2 url=''"


def test_a_source_with_no_uploads_sees_an_empty_list(
    source, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A connector that talks to an API is the common case; no files is normal.
    monkeypatch.setattr(
        "src.sources.custom.source.download_source_files",
        lambda *_args, **_kwargs: 0,
    )
    result = source(build_recipe(FILES_NOTEBOOK)).test_connection()
    assert result["status"] == "SUCCESS"
    assert result["message"] == "0: "


def test_an_unreachable_files_endpoint_does_not_fail_the_scan(
    source, monkeypatch: pytest.MonkeyPatch
) -> None:
    def explode(*_args, **_kwargs):
        raise RuntimeError("connection refused")

    monkeypatch.setattr("src.sources.custom.source.download_source_files", explode)
    result = source(build_recipe(SIMPLE_NOTEBOOK)).test_connection()
    assert result["status"] == "SUCCESS"


# -- local folders -----------------------------------------------------------


def folder_recipe(path: str, notebook: str) -> dict[str, Any]:
    recipe = build_recipe(notebook)
    recipe["optional"]["local_folders"] = [{"name": "dumps", "path": path}]
    return recipe


FOLDER_NOTEBOOK = """from classifyre import Asset, ctx, parse


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": str(ctx.folder("dumps"))}


def extract():
    for path in sorted(ctx.folder("dumps").rglob("*.txt")):
        yield Asset(id=path.name, name=path.name, content=parse(path).text)
"""


def test_a_configured_folder_is_readable_by_name(source, tmp_path) -> None:
    root = tmp_path / "dumps"
    root.mkdir()
    (root / "one.txt").write_text("first dump", encoding="utf-8")
    (root / "two.txt").write_text("second dump", encoding="utf-8")

    assets = collect(source(folder_recipe(str(root), FOLDER_NOTEBOOK)))
    assert [asset.name for asset in assets] == ["one.txt", "two.txt"]


def test_a_folder_that_is_not_there_fails_before_the_scan_starts(source, tmp_path) -> None:
    # Learning this from a traceback inside extract() costs a run.
    missing = tmp_path / "not-created"
    result = source(folder_recipe(str(missing), FOLDER_NOTEBOOK)).test_connection()
    assert result["status"] == "FAILURE"
    assert "dumps" in result["message"]
