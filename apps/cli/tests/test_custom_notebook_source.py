"""Tests for the CUSTOM (notebook-backed) source.

These drive the real bridge subprocess rather than mocking it: the whole point
of the design is that user code runs out-of-process, so the protocol, the
timeout and the kill path are the parts most worth testing. The sandbox venv is
disabled here (CLASSIFYRE_NOTEBOOK_SANDBOX=0) so the bridge runs under the test
interpreter instead of resolving a venv from the network.
"""

from __future__ import annotations

import asyncio
import time
from pathlib import Path

import pytest

from src.sources.custom_notebook import runner, store, template
from src.sources.custom_notebook.source import CustomNotebookSource

pytestmark = pytest.mark.usefixtures("no_sandbox")


@pytest.fixture
def no_sandbox(monkeypatch):
    monkeypatch.setenv("CLASSIFYRE_NOTEBOOK_SANDBOX", "0")


def recipe(**overrides):
    base = {
        "type": "CUSTOM",
        "required": {"variables": {"GREETING": "hello"}},
        "masked": {"secrets": {"TOKEN": "s3cr3t"}},
        "sampling": {"strategy": "ALL"},
    }
    base.update(overrides)
    return base


NOTEBOOK = """
from classifyre import AssetContent, AssetRef, context

ctx = context()


def check(ctx):
    if not ctx.variables["GREETING"]:
        raise RuntimeError("no greeting")


def discover(ctx):
    return [
        AssetRef(id="b", name="Beta", url="https://x/b", kind="page", links=["a"]),
        AssetRef(id="a", name="Alpha", url="https://x/a", kind="record"),
    ]


def fetch(ctx, ref):
    return AssetContent(text=f"{ctx.variables['GREETING']} {ref.id} {ctx.secrets['TOKEN']}")
"""


def make_source(monkeypatch, notebook=NOTEBOOK, revision=7, **overrides):
    monkeypatch.setattr(
        store, "load", lambda _source_id, _session=None: store.Notebook(revision, notebook)
    )
    return CustomNotebookSource(recipe(**overrides), source_id="src-1", runner_id="run-1")


# ── template ─────────────────────────────────────────────────────────────


def test_starter_notebook_satisfies_the_contract():
    info = template.validate(template.STARTER_NOTEBOOK)
    assert {"check", "discover", "fetch"} <= info.functions


def test_validate_rejects_a_notebook_missing_discover():
    with pytest.raises(template.NotebookValidationError, match="discover"):
        template.validate("def fetch(ctx, ref):\n    return None\n")


def test_validate_reports_a_syntax_error_with_its_line():
    with pytest.raises(template.NotebookValidationError, match="line 1"):
        template.validate("def discover(:\n")


def test_validation_never_executes_the_notebook(tmp_path):
    # A notebook that would blow up on import must still validate cleanly.
    marker = tmp_path / "side-effect"
    source = (
        f"open({str(marker)!r}, 'w').write('x')\n"
        "raise SystemExit(1)\n"
        "def discover(ctx): ...\n"
        "def fetch(ctx, ref): ...\n"
    )
    template.validate(source)
    assert not marker.exists()


def test_header_repoints_the_sdk_while_keeping_author_dependencies():
    original = template.apply_header(template.STARTER_NOTEBOOK, "/opt/classifyre/sdk")
    # marimo's package installer inlines a new dependency
    edited = original.replace(
        '#     "marimo>=0.24.0",', '#     "marimo>=0.24.0",\n#     "httpx>=0.27",'
    )

    # the same notebook later runs on a machine where the SDK lives elsewhere
    moved = template.apply_header(edited, "/Applications/Classifyre.app/sdk")

    assert "httpx>=0.27" in template.parse_dependencies(moved)
    assert '{ path = "/Applications/Classifyre.app/sdk" }' in moved
    assert moved.count("classifyre-sdk = { path") == 1


# ── bridge protocol ──────────────────────────────────────────────────────


def bridge(tmp_path: Path, notebook: str, **env) -> runner.NotebookProcess:
    runner.prepare_workspace(tmp_path, notebook, str(Path("packages/py-sdk").resolve()))
    return runner.NotebookProcess(
        tmp_path,
        {
            "CLASSIFYRE_NOTEBOOK_PATH": str(tmp_path / template.NOTEBOOK_FILENAME),
            "CLASSIFYRE_VAR_GREETING": "hi",
            "CLASSIFYRE_SECRET_TOKEN": "t",
            **env,
        },
        startup_timeout=60,
    )


def test_discover_and_fetch_round_trip(tmp_path):
    process = bridge(tmp_path, NOTEBOOK)
    try:
        refs = list(process.discover(30))
        assert [ref["id"] for ref in refs] == ["b", "a"]
        assert refs[0]["kind"] == "page" and refs[0]["links"] == ["a"]

        content = process.fetch(refs[1], 30)
        assert content["text"] == "hi a t"
    finally:
        process.close()


def test_notebook_print_does_not_corrupt_the_protocol(tmp_path):
    noisy = NOTEBOOK.replace(
        "def fetch(ctx, ref):",
        "def fetch(ctx, ref):\n    print('chatty debugging output')\n    print('{\"t\": \"ref\"}')",
    )
    process = bridge(tmp_path, noisy)
    try:
        refs = list(process.discover(30))
        content = process.fetch(refs[0], 30)
        assert content["text"].startswith("hi b")
    finally:
        process.close()


def test_an_exception_in_fetch_surfaces_with_its_traceback(tmp_path):
    broken = NOTEBOOK.replace(
        "    return AssetContent(text=f\"{ctx.variables['GREETING']} {ref.id} {ctx.secrets['TOKEN']}\")",
        '    raise ValueError("upstream returned 500")',
    )
    process = bridge(tmp_path, broken)
    try:
        refs = list(process.discover(30))
        with pytest.raises(runner.NotebookExecutionError) as excinfo:
            process.fetch(refs[0], 30)
        assert "upstream returned 500" in str(excinfo.value)
        assert "ValueError" in excinfo.value.detail
    finally:
        process.close()


def test_a_hanging_notebook_is_killed_rather_than_waited_on(tmp_path):
    hanging = NOTEBOOK.replace(
        "def fetch(ctx, ref):",
        "def fetch(ctx, ref):\n    import time; time.sleep(600)",
    )
    process = bridge(tmp_path, hanging)
    try:
        refs = list(process.discover(30))
        started = time.monotonic()
        with pytest.raises(runner.NotebookExecutionError, match="did not respond within"):
            process.fetch(refs[0], 2)
        assert time.monotonic() - started < 30
        assert process._process is None or process._process.poll() is not None
    finally:
        process.close()


def test_a_notebook_that_fails_to_import_reports_why(tmp_path):
    process = bridge(tmp_path, "raise RuntimeError('bad credentials at import')\n")
    with pytest.raises(runner.NotebookExecutionError, match="bad credentials at import"):
        process.start()
    process.close()


# ── source ───────────────────────────────────────────────────────────────


def collect(source):
    async def run():
        return [asset for batch in [b async for b in source.extract_raw()] for asset in batch]

    return asyncio.run(run())


def test_extract_builds_assets_that_satisfy_the_metadata_contract(monkeypatch):
    # validate_metadata raises under pytest, so simply constructing these
    # assets is the contract assertion.
    source = make_source(monkeypatch)
    try:
        assets = collect(source)
    finally:
        source.cleanup()

    by_name = {asset.name: asset for asset in assets}
    assert set(by_name) == {"Alpha", "Beta"}
    assert by_name["Beta"].asset_kind == "page"
    assert by_name["Beta"].metadata["links_count"] == 1
    assert by_name["Alpha"].asset_kind == "record"
    assert by_name["Alpha"].metadata["resource_id"] == "a"


def test_links_are_stored_as_asset_hashes_not_raw_ids(monkeypatch):
    source = make_source(monkeypatch)
    try:
        assets = {asset.name: asset for asset in collect(source)}
    finally:
        source.cleanup()
    assert assets["Beta"].links == [assets["Alpha"].hash]


def test_asset_hash_is_stable_across_runs(monkeypatch):
    hashes = []
    for _ in range(2):
        source = make_source(monkeypatch)
        try:
            hashes.append(sorted(asset.hash for asset in collect(source)))
        finally:
            source.cleanup()
    assert hashes[0] == hashes[1]


def test_fetch_content_reaches_the_notebook(monkeypatch):
    source = make_source(monkeypatch)
    try:
        assets = {asset.name: asset for asset in collect(source)}
        _raw, text = asyncio.run(source.fetch_content(assets["Alpha"].hash))
    finally:
        source.cleanup()
    assert text == "hello a s3cr3t"


def test_content_resolves_by_url_as_well_as_hash(monkeypatch):
    # The detector pipeline probes external_url before hash, so a source that
    # only indexes hashes costs a failed lookup per asset (and used to log a
    # warning that looked like a real failure).
    source = make_source(monkeypatch)
    try:
        assets = {asset.name: asset for asset in collect(source)}
        by_url = asyncio.run(source.fetch_content(assets["Alpha"].external_url))
        by_hash = asyncio.run(source.fetch_content(assets["Alpha"].hash))
    finally:
        source.cleanup()

    assert by_url is not None and by_url == by_hash


def test_evicting_an_asset_drops_all_of_its_aliases(monkeypatch):
    source = make_source(monkeypatch)
    try:
        assets = {asset.name: asset for asset in collect(source)}
        alpha = assets["Alpha"]
        source.evict_asset_cache(alpha.hash)
        assert alpha.hash not in source._ref_by_hash
        assert alpha.external_url not in source._ref_by_hash
    finally:
        source.cleanup()


def test_automatic_sampling_advances_a_cursor_and_wraps(monkeypatch):
    many = NOTEBOOK.replace(
        """    return [
        AssetRef(id="b", name="Beta", url="https://x/b", kind="page", links=["a"]),
        AssetRef(id="a", name="Alpha", url="https://x/a", kind="record"),
    ]""",
        '    return [AssetRef(id=f"item-{n:02d}") for n in range(5)]',
    )
    sampling = {"strategy": "AUTOMATIC", "rows_per_page": 10}

    source = make_source(monkeypatch, notebook=many, sampling=sampling)
    monkeypatch.setattr(source, "sampling_window_size", lambda _default=100: 2)
    try:
        first = [asset.metadata["resource_id"] for asset in collect(source)]
        cursor = source.current_sampling_cursor()
    finally:
        source.cleanup()

    assert first == ["item-00", "item-01"]
    assert cursor == {"assets": 2}


def test_max_assets_bounds_a_runaway_discover(monkeypatch):
    many = NOTEBOOK.replace(
        """    return [
        AssetRef(id="b", name="Beta", url="https://x/b", kind="page", links=["a"]),
        AssetRef(id="a", name="Alpha", url="https://x/a", kind="record"),
    ]""",
        '    return [AssetRef(id=f"item-{n:04d}") for n in range(1000)]',
    )
    source = make_source(monkeypatch, notebook=many, optional={"execution": {"max_assets": 3}})
    try:
        assert len(collect(source)) == 3
    finally:
        source.cleanup()


def test_test_connection_reports_the_notebook_revision(monkeypatch):
    source = make_source(monkeypatch)
    result = source.test_connection()
    assert result["status"] == "SUCCESS"
    assert "7" in result["message"]


def test_test_connection_fails_with_the_notebooks_own_message(monkeypatch):
    failing = NOTEBOOK.replace(
        '        raise RuntimeError("no greeting")',
        '        raise RuntimeError("no greeting")\n    raise RuntimeError("host unreachable")',
    )
    source = make_source(monkeypatch, notebook=failing)
    result = source.test_connection()
    assert result["status"] == "FAILURE"
    assert "host unreachable" in result["message"]


def test_abort_kills_the_notebook_process(monkeypatch):
    source = make_source(monkeypatch)
    try:
        collect(source)
        process = source._process
        assert process is not None and process._process is not None
        source.abort()
        assert process._process is None or process._process.poll() is not None
    finally:
        source.cleanup()


def test_a_bad_configuration_key_is_refused_not_mangled(monkeypatch):
    source = make_source(monkeypatch)
    source.config.required.variables = {"not a key": "x"}
    with pytest.raises(ValueError, match="not a usable configuration key"):
        source._notebook_env()
    source.cleanup()


def test_secrets_never_appear_in_the_notebook_file(monkeypatch):
    source = make_source(monkeypatch)
    try:
        collect(source)
        written = (source._workspace / template.NOTEBOOK_FILENAME).read_text()
        assert "s3cr3t" not in written
    finally:
        source.cleanup()
