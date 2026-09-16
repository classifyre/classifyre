"""The CUSTOM source: notebook Assets in, scan results out.

The adapter owns everything a connector author should not have to: hashes,
checksums, link resolution, metadata validation, sampling windows, and keeping
notebook code away from this process's credentials.
"""

from __future__ import annotations

import asyncio
import base64
import os
from typing import Any

import pytest

from src.notebook.contract import NotebookContractError
from src.sources import get_source
from src.sources.asset_metadata import is_open_kind, validate_metadata
from src.sources.custom.env import ALLOWED_ENV_KEYS, scrubbed_environment
from src.sources.custom.source import CustomSource, CustomSourceError
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


PARTIAL_COVERAGE_NOTEBOOK = """from classifyre import Asset, ctx


def test_connection() -> dict:
    return {"status": "SUCCESS"}


def extract():
    ctx.set_partial_coverage("walks one slice of the register per run")
    yield Asset(id="rec-1", name="Record 1", content="body")
"""


def test_a_cohort_connector_can_declare_partial_coverage(source) -> None:
    """Absence must stop implying deletion when the run only looked at a slice.

    Under strategy=ALL the platform retires every asset a run did not see. A
    connector that chooses its own cohort each run never sees the rest of the
    source, and the sampling strategy cannot say so on its behalf -- it
    describes what the runtime does with the stream, not how much of the source
    was asked for.
    """
    instance = source(build_recipe(PARTIAL_COVERAGE_NOTEBOOK))
    assert instance.partial_coverage is False
    collect(instance)
    assert instance.partial_coverage is True
    assert "one slice" in instance.partial_coverage_reason


def test_an_ordinary_connector_does_not_declare_partial_coverage(source) -> None:
    instance = source()
    collect(instance)
    assert instance.partial_coverage is False


def test_the_custom_source_opts_into_the_scan_cache(source) -> None:
    """A notebook re-yields its whole cohort every run.

    Without the cache every re-yielded asset is re-detected from scratch: the
    Firmenbuch AI source burned 68 minutes a run re-analysing 326 unchanged
    filings, and the PDF source 67 minutes re-converting 672 unchanged
    documents. Detection is where a notebook run's time goes.
    """
    instance = source()
    assert instance.SUPPORTS_SCAN_CACHE is True
    # metadata mode is only sound because the checksum is a real content
    # digest; see the class comment.
    assert instance.scan_cache_verification_mode() == "metadata"


def test_the_checksum_covers_fetched_bytes(source) -> None:
    """Two files whose extracted text matches must not share a checksum.

    The text in the checksum is what the parser produced, not what was
    fetched — so without the raw-byte digest a metadata-mode cache could skip a
    genuinely different document.
    """
    notebook = """from classifyre import Asset


def test_connection() -> dict:
    return {"status": "SUCCESS"}


def extract():
    yield Asset(id="doc", name="doc", content_bytes=BYTES, mime_type="text/plain")
"""
    first = collect(source(build_recipe(notebook.replace("BYTES", "b'alpha'"))))
    second = collect(source(build_recipe(notebook.replace("BYTES", "b'beta '"))))
    assert first[0].checksum != second[0].checksum


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


NOTE_BYTES = b"Invoice 42\nTotal: 1.234,00 EUR\n"

FILE_NOTEBOOK = f'''import base64

from classifyre import Asset


def test_connection() -> dict:
    return {{"status": "SUCCESS", "message": "ok"}}


def extract():
    yield Asset(
        id="note",
        name="note.txt",
        url="https://example.com/note.txt",
        content_bytes=base64.b64decode("{base64.b64encode(NOTE_BYTES).decode()}"),
        kind="file",
        metadata={{"folder": "inbox"}},
    )
'''


def test_discovery_does_not_parse_file_bytes(source, monkeypatch: pytest.MonkeyPatch) -> None:
    # Parsing a PDF inline on the discovery loop stalled every asset behind
    # each document (100 discovered, 0 processed). Discovery may only work out
    # what the bytes are; text extraction belongs to phase 2.
    from src.utils import file_parser

    def forbidden(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("discovery parsed file bytes")

    monkeypatch.setattr(file_parser, "extract_text", forbidden)
    monkeypatch.setattr(file_parser, "parse_bytes", forbidden)

    asset = collect(source(build_recipe(FILE_NOTEBOOK)))[0]
    assert str(asset.asset_type) == "TXT"
    assert asset.metadata["mime_type"] == "text/plain"
    assert asset.metadata["folder"] == "inbox"


def test_file_text_is_extracted_in_phase_two(source) -> None:
    from src.pipeline.parsed_content_provider import ParsedContentProvider

    instance = source(build_recipe(FILE_NOTEBOOK))
    asset = collect(instance)[0]

    async def pages() -> list[str]:
        return [page async for page in ParsedContentProvider(instance).fetch_text_pages(asset.hash)]

    assert "Invoice 42" in "".join(asyncio.run(pages()))


def test_file_asset_checksum_basis_is_a_compatibility_contract(source) -> None:
    # The basis decides whether every stored asset reads as changed. Discovery
    # never had a file's extracted text (it read a field the parser does not
    # set), so the basis hashes the empty string plus the bytes -- and must go
    # on doing exactly that, or the next run re-scans a whole corpus.
    import hashlib

    instance = source(build_recipe(FILE_NOTEBOOK))
    asset = collect(instance)[0]
    expected = instance.calculate_checksum(
        {
            "id": "note",
            "name": "note.txt",
            "url": "https://example.com/note.txt",
            "metadata": asset.metadata,
            "content_length": 0,
            "content_sha256": hashlib.sha256(b"").hexdigest(),
            "tags": {},
            "content_bytes_sha256": hashlib.sha256(NOTE_BYTES).hexdigest(),
        }
    )
    assert asset.checksum == expected


REFERENCE_NOTEBOOK = f'''import base64

from classifyre import Asset


def test_connection() -> dict:
    return {{"status": "SUCCESS", "message": "ok"}}


def extract():
    yield Asset(
        id="filing",
        name="filing.txt",
        url="https://example.com/filing.txt",
        content_bytes=base64.b64decode("{base64.b64encode(NOTE_BYTES).decode()}"),
        kind="file",
        extract=False,
        reference_reason="27 pages; converting it took 17 minutes",
        tags={{"filed_document": "annual report"}},
    )
    yield Asset(id="bare", name="bare", kind="record", extract=False)
'''


def test_a_reference_asset_is_recorded_not_extracted(source) -> None:
    instance = source(build_recipe(REFERENCE_NOTEBOOK))
    filing, bare = collect(instance)

    # Stated on the asset, with everything the bytes could tell cheaply.
    assert filing.metadata["content_reference"] == "27 pages; converting it took 17 minutes"
    assert filing.metadata["size_bytes"] == len(NOTE_BYTES)
    assert filing.metadata["mime_type"] == "text/plain"
    assert bare.metadata["content_reference"] == "Recorded without content extraction"

    # Nothing kept to extract or scan, and the pipeline is told so.
    assert instance.extracts_content(filing.hash) is False
    assert asyncio.run(instance.fetch_content_bytes(filing.hash)) is None
    assert asyncio.run(instance.fetch_content(filing.hash)) is None
    # Tags are facts about the asset, not its content: they still apply.
    assert instance.asset_tags(filing.hash) == {"filed_document": "annual report"}


def test_switching_extraction_changes_the_checksum(source) -> None:
    # Otherwise the scan cache would keep skipping an asset whose handling changed.
    reference = collect(source(build_recipe(REFERENCE_NOTEBOOK)))[0]
    extracted = collect(
        source(
            build_recipe(
                REFERENCE_NOTEBOOK.replace(
                    '        extract=False,\n        reference_reason="27 pages; converting it took 17 minutes",\n',
                    "",
                )
            )
        )
    )[0]
    assert reference.hash == extracted.hash
    assert reference.checksum != extracted.checksum


QUERY_NOTEBOOK = """from classifyre import Asset, AssetQueryError, ctx


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": "ok"}


def extract():
    page = ctx.query_assets(
        "Firmenbuch Register",
        kind="record",
        where={"legal_form_code": {"in": ["GES", "AG"]}},
        exclude_visited={"key": "firmenbuchnummer", "since_days": 90},
        select=["firmenbuchnummer"],
    )
    for company in page.items:
        fn = company.metadata["firmenbuchnummer"]
        yield Asset(id=f"filing-{fn}", name=f"Filing {fn}", content=f"FN {fn}")
    if ctx.var("second_page", "") and page.next_cursor:
        try:
            ctx.query_assets("Firmenbuch Register", cursor=page.next_cursor)
        except AssetQueryError as exc:
            yield Asset(id="refused", name="refused", content=str(exc))
"""


class _FakeResponse:
    def __init__(self, status: int, body: dict[str, Any]) -> None:
        self.status_code = status
        self._body = body
        self.text = str(body)

    def json(self) -> dict[str, Any]:
        return self._body


def _fake_api(monkeypatch: pytest.MonkeyPatch, responses: list[_FakeResponse]):
    import src.sources.custom.source as custom_source

    calls: list[dict[str, Any]] = []

    def post(url: str, **kwargs: Any) -> _FakeResponse:
        calls.append({"url": url, **kwargs})
        return responses.pop(0)

    monkeypatch.setenv("CLASSIFYRE_OUTPUT_REST_URL", "http://api.test/ns-1")
    monkeypatch.setenv("CLASSIFYRE_INTERNAL_KEY", "internal-key")
    monkeypatch.setattr(custom_source.requests, "post", post)
    return calls


def _page(*fns: str, cursor: str | None = None) -> _FakeResponse:
    return _FakeResponse(
        200,
        {
            "items": [
                {
                    "assetHash": f"h-{fn}",
                    "externalId": f"company:{fn}",
                    "name": fn,
                    "kind": "record",
                    "url": "",
                    "metadata": {"firmenbuchnummer": fn},
                }
                for fn in fns
            ],
            "nextCursor": cursor,
            "callsRemaining": 99,
        },
    )


def test_a_notebook_reads_its_cohort_through_the_parent(source, monkeypatch) -> None:
    calls = _fake_api(monkeypatch, [_page("606601k", "008316f")])
    instance = source(build_recipe(QUERY_NOTEBOOK))

    assets = collect(instance)

    assert [asset.name for asset in assets] == ["Filing 606601k", "Filing 008316f"]
    # The parent made the call, for this run, with the credentials the
    # notebook never had.
    assert calls[0]["url"] == "http://api.test/ns-1/runners/run-1/assets/query"
    assert calls[0]["headers"]["X-Classifyre-Internal-Key"] == "internal-key"
    assert calls[0]["json"]["excludeVisited"] == {"key": "firmenbuchnummer", "sinceDays": 90}
    assert instance.partial_coverage is True


def test_a_refused_query_reaches_the_notebook_as_an_error_it_can_handle(
    source, monkeypatch
) -> None:
    _fake_api(
        monkeypatch,
        [
            _page("606601k", cursor="c-1"),
            _FakeResponse(429, {"message": "This run has used its 100 asset queries."}),
        ],
    )
    recipe = build_recipe(QUERY_NOTEBOOK)
    recipe["optional"]["variables"]["second_page"] = "yes"
    instance = source(recipe)
    assets = collect(instance)

    [refused] = [asset for asset in assets if asset.name == "refused"]
    content = asyncio.run(instance.fetch_content(refused.hash))
    assert content is not None
    assert "refused (429)" in content[1]
    assert "100 asset queries" in content[1]


def test_a_local_run_has_no_runner_id_so_the_scan_run_guard_fires(request) -> None:
    # A local run is not a scan run: the relay must refuse before building a
    # URL, not query the API as a placeholder run id.
    instance = get_source(build_recipe(QUERY_NOTEBOOK), source_id="src-1")
    request.addfinalizer(instance.cleanup)
    assert instance.runner_id is None
    with pytest.raises(CustomSourceError, match="needs a scan run"):
        instance._relay_asset_query({"source": "Firmenbuch Register"})


def test_a_silent_notebook_trips_the_read_timeout() -> None:
    read_fd, write_fd = os.pipe()
    try:
        with os.fdopen(read_fd) as reader:
            with pytest.raises(CustomSourceError, match="did not respond within"):
                CustomSource._wait_readable(reader, 0.05)
            os.write(write_fd, b'{"type": "ready"}\n')
            CustomSource._wait_readable(reader, 5.0)
    finally:
        os.close(write_fd)


COHORT_NOTEBOOK = """from classifyre import Asset, ctx


def test_connection() -> dict:
    return {"status": "SUCCESS", "message": "ok"}


def extract():
    universe = [f"{n:03d}" for n in range(1, 51)]
    for item in ctx.cohort("register", universe, bands={"newest": 60, "oldest": 40}, size=5):
        yield Asset(id=f"company:{item.key}", name=item.key, content=f"company {item.key}",
                    cohort=item if ctx.var("stamp", "yes") == "yes" else None)
"""


def test_cohort_stats_reach_the_run_and_stamping_never_changes_a_checksum(source) -> None:
    stamped_source = source(build_recipe(COHORT_NOTEBOOK))
    stamped = {asset.name: asset for asset in collect(stamped_source)}
    assert stamped_source.cohort_stats["register"]["bands"]["newest"]["visited"] == 3
    assert stamped["050"].metadata["_cohort"]["band"] == "newest"

    recipe = build_recipe(COHORT_NOTEBOOK)
    recipe["optional"]["variables"]["stamp"] = "no"
    plain = {asset.name: asset for asset in collect(source(recipe))}
    assert "_cohort" not in plain["050"].metadata
    assert stamped["050"].checksum == plain["050"].checksum


def test_platform_weights_reach_the_notebook(source, monkeypatch) -> None:
    import base64
    import json

    monkeypatch.setenv(
        "CLASSIFYRE_COHORT_WEIGHTS",
        base64.b64encode(json.dumps({"register": {"oldest": 100}}).encode()).decode(),
    )
    assets = collect(source(build_recipe(COHORT_NOTEBOOK)))
    assert {asset.metadata["_cohort"]["band"] for asset in assets} == {"oldest"}


def test_weights_the_api_puts_in_the_recipe_reach_the_notebook(source) -> None:
    recipe = build_recipe(COHORT_NOTEBOOK)
    recipe["optional"]["cohort_weights"] = {
        "mode": "auto",
        "effective": {"register": {"newest": 100}},
    }
    assets = collect(source(recipe))
    assert {asset.metadata["_cohort"]["band"] for asset in assets} == {"newest"}


def test_fetch_content_does_not_ask_a_notebook_that_cannot_answer(
    source, monkeypatch: pytest.MonkeyPatch
) -> None:
    # The pipeline asks by URL, then by hash. Neither is worth a subprocess
    # round trip when the notebook defines no fetch_content().
    instance = source(build_recipe(FILE_NOTEBOOK))
    asset = collect(instance)[0]

    def forbidden(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("asked the notebook")

    monkeypatch.setattr(instance, "_call", forbidden)
    assert asyncio.run(instance.fetch_content(asset.external_url)) is None
    assert asyncio.run(instance.fetch_content(asset.hash)) is None


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
