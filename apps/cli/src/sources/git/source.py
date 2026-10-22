"""Scan the files of a single branch of any Git repository.

Provider-agnostic on purpose: everything is done with the ``git`` binary over the
wire protocol, never a provider REST API, so GitHub, GitLab, Bitbucket, Azure
DevOps, Gitea and a bare repository on a box somewhere are all the same source.

Two properties drive the design:

**Nothing is shared between runs.** Every scan clones into its own empty
directory with its own ``HOME`` and its own git configuration, and deletes all of
it when the run ends — normally, on abort, and on failure. There is no clone
cache and no credential cache, so one job can never see another job's objects or
another job's secrets. In Kubernetes the pod dies anyway; in a long-lived container, where
the process is long-lived and scans many sources, that guarantee has to be made
by this module.

**The tree is catalogued before the contents are transferred.** ``git clone
--filter=blob:none`` fetches commits and trees but no file contents, so every
file in the branch becomes an asset from Git metadata alone — path, blob object
id, mode — and its bytes are fetched individually, on demand, only for the files
a run actually reaches. That is what makes a repository whose history dwarfs the
slice being sampled affordable. The default sits between the two extremes:
``blob_limit`` puts every file at or under the memory threshold into the initial
pack (one round trip for all the code and documentation, with exact sizes) and
leaves the large ones to be fetched one at a time.
"""

from __future__ import annotations

import base64
import logging
import os
import re
import shutil
import stat
import subprocess
import tempfile
import time
from collections.abc import AsyncGenerator, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from fnmatch import fnmatch
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit, urlunsplit

from ...models.generated_input import GitInput
from ...models.generated_single_asset_scan_results import SingleAssetScanResults
from ...utils.payload import PayloadTooLargeError
from ..object_storage.base import ObjectRef, ObjectStorageSourceBase

logger = logging.getLogger(__name__)

_CHUNK_BYTES = 256 * 1024

# Git object id for the empty blob. Present in every repository without being
# fetched, so a zero-byte file never needs a round trip to read.
_EMPTY_BLOB_OID = "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391"

_GLOB_CHARACTERS = ("*", "?", "[")

# Transports a repository may be reached over. Deliberately an allowlist: git
# also understands `ext::<command>`, where the "URL" is a shell command it runs,
# which would turn a source's configuration field into remote code execution.
_ALLOWED_URL_SCHEMES = frozenset({"http", "https", "ssh", "git", "file"})

# Username each host expects when a token is used as the password over https.
# Getting this wrong is the most common cause of an opaque 403, and the user
# should not have to know the convention, so it is derived from the host.
_TOKEN_USERNAMES = {
    "github.com": "x-access-token",
    "gitlab.com": "oauth2",
    "bitbucket.org": "x-token-auth",
}
_DEFAULT_TOKEN_USERNAME = "git"

# scp-style remote: user@host:path, distinguished from ssh://host/path by having
# no scheme and from a Windows path by requiring the @.
_SCP_STYLE = re.compile(r"^(?P<user>[^/@]+)@(?P<host>[^/:]+):(?P<path>.+)$")

# How many times a single git invocation is attempted before the scan gives up
# on it. Transient network and promisor failures are retried with exponential
# backoff, so a blip costs seconds instead of the whole run. An operational
# knob rather than per-source config (like CLASSIFYRE_GIT_BINARY):
# CLASSIFYRE_GIT_MAX_ATTEMPTS.
_DEFAULT_GIT_MAX_ATTEMPTS = 3
_GIT_RETRY_BASE_DELAY_SECONDS = 2.0
_GIT_RETRY_MAX_DELAY_SECONDS = 30.0

# Substrings (matched lowercase) of git stderr that mean "try again" rather
# than "misconfigured". Kept to failures outside the scan's control: dropped
# connections, overloaded or unreachable servers, and a promisor remote that
# did not hand over an object on this attempt. Authentication failures, missing
# branches, unknown repositories and bad URLs fail immediately.
_TRANSIENT_GIT_ERROR_PATTERNS = (
    "from promisor remote",
    "lazy fetching disabled",
    "connection reset",
    "connection was reset",
    "connection timed out",
    "operation timed out",
    "timed out",
    "transfer closed",
    "early eof",
    "rpc failed",
    "http 502",
    "http 503",
    "http 504",
    "bad gateway",
    "service unavailable",
    "gateway timeout",
    "could not resolve host",
    "temporary failure in name resolution",
    "network is unreachable",
    "no route to host",
    "connection refused",
    "the remote end hung up",
)

# Substrings (matched lowercase) showing the clone arrived without an object
# the listing needs. Unlike a transient failure, retrying the same command
# cannot help — the missing objects have to be fetched first.
_MISSING_OBJECT_PATTERNS = (
    "from promisor remote",
    "lazy fetching disabled",
    "did not find object",
    "unable to read",
    "bad object",
    "missing object",
)


class GitCommandError(RuntimeError):
    """A git invocation failed, with its stderr already redacted for logging."""


@dataclass(frozen=True)
class GitObjectRef(ObjectRef):
    """A file in the scanned commit's tree.

    ``key`` is the repo-relative path and ``blob_id`` the Git object id, which is
    a hash of the file's contents — that is what ``etag`` carries, so the scan
    cache can trust an unchanged checksum without re-reading the bytes.

    ``size_known`` is false when the blob was not part of the initial transfer
    (``blobless``, or a file above the ``blob_limit`` threshold). Git cannot
    report the size of an object it does not have, so ``size`` stays 0 until the
    file is read rather than being guessed at.
    """

    blob_id: str = ""
    size_known: bool = True
    lfs_pointer: bool = False


class GitSource(ObjectStorageSourceBase):
    """Scan one branch of a Git repository, file by file.

    Reuses the object-storage pipeline: each tracked file becomes an ``ObjectRef``
    keyed by its repo-relative path, so sampling, MIME resolution, text
    extraction, file metadata, archive members and embedded-image child assets
    all come from ``ObjectStorageSourceBase`` exactly as they do for a bucket.
    """

    source_type = "git"
    provider_label = "GIT"
    input_model = GitInput

    # The blob id is a hash of the file's contents, so an unchanged checksum is
    # proof the bytes are unchanged — no need to re-read them to be sure.
    SCAN_CACHE_VERIFY = "metadata"

    # Git serves whole objects; there is no byte-range access to a blob.
    SUPPORTS_RANGE_READS = False

    def __init__(
        self,
        recipe: dict[str, Any],
        source_id: str | None = None,
        runner_id: str | None = None,
    ) -> None:
        super().__init__(recipe, source_id=source_id, runner_id=runner_id)
        self._workspace: tempfile.TemporaryDirectory[str] | None = None
        self._repo_dir: Path | None = None
        self._env: dict[str, str] | None = None
        self._commit_sha: str | None = None
        self._resolved_branch: str | None = None
        self._ref_by_key: dict[str, GitObjectRef] = {}
        self._lfs_globs: list[str] = []

    # ── configuration ────────────────────────────────────────────────────

    def _repository_url(self) -> str:
        """The configured remote, checked for the shapes that are not remotes.

        Git's URL space includes ``ext::<command>``, which makes the "address" an
        arbitrary shell command git will run, and a value beginning with ``-``
        would be read as an option rather than a URL. Neither can reach the
        command line, so both are rejected here — at the single point every
        invocation gets the URL from.
        """
        url = str(self.config.required.repository_url or "").strip()
        if not url:
            raise ValueError("Git scanning requires required.repository_url")
        if url.startswith("-"):
            raise ValueError("required.repository_url must be a URL, not a command-line option")

        scheme = urlsplit(url).scheme.lower()
        if not scheme and _SCP_STYLE.match(url):
            return url
        if scheme not in _ALLOWED_URL_SCHEMES:
            raise ValueError(
                f"Unsupported repository URL scheme '{scheme or url[:16]}'. Use https://, "
                "http://, ssh://, git://, file:// or the scp-style git@host:org/repo.git."
            )
        return url

    def _auth_option(self, key: str, default: Any = None) -> Any:
        optional = self.config.optional
        auth = getattr(optional, "auth", None) if optional else None
        if auth is not None:
            value = getattr(auth, key, None)
            if value is not None:
                return value
        return default

    def _auth_method(self) -> str:
        value = self._auth_option("auth_method", "none")
        return str(getattr(value, "value", value) or "none").strip().lower()

    def _clone_strategy(self) -> str:
        value = self._connection_option("clone_strategy", "blob_limit")
        return str(getattr(value, "value", value) or "blob_limit").strip().lower()

    def _depth(self) -> int:
        value = self._connection_option("depth", 1)
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 1
        return max(parsed, 0)

    def _clone_timeout_seconds(self) -> float:
        return self._timeout_option("clone_timeout_seconds", 1800.0, minimum=30.0)

    def _command_timeout_seconds(self) -> float:
        return self._timeout_option("command_timeout_seconds", 300.0, minimum=5.0)

    def _timeout_option(self, key: str, default: float, *, minimum: float) -> float:
        value = self._connection_option(key, default)
        try:
            parsed = float(value)
        except (TypeError, ValueError):
            return default
        return max(parsed, minimum)

    def _configured_branch(self) -> str | None:
        return self._string_or_none(self._scope_option("branch"))

    def _include_last_commit(self) -> bool:
        return bool(self._scope_option("include_last_commit", False))

    def _path_patterns(self, key: str) -> list[str]:
        values = self._scope_option(key, []) or []
        patterns: list[str] = []
        for value in values:
            if not isinstance(value, str):
                continue
            cleaned = value.strip().strip("/")
            if cleaned:
                patterns.append(cleaned)
        return list(dict.fromkeys(patterns))

    @staticmethod
    def _path_matches(path: str, pattern: str) -> bool:
        """Whether a repo-relative path is covered by one include/exclude entry.

        A pattern with glob characters is matched as a glob; anything else is a
        folder (or exact file) prefix, so ``docs`` covers ``docs/a/b.md`` without
        the user having to write ``docs/**``. Both spellings are common in
        ``.gitignore``-shaped config, and guessing wrong silently scans the wrong
        half of a repository.
        """
        if any(character in pattern for character in _GLOB_CHARACTERS):
            if fnmatch(path, pattern):
                return True
            # `docs/**` should also cover `docs/a.md`, which fnmatch's `**` does
            # not (it has no recursive-glob semantics — `*` already spans `/`).
            collapsed = pattern.replace("**/", "").replace("/**", "/*")
            return fnmatch(path, collapsed)
        return path == pattern or path.startswith(f"{pattern}/")

    def _path_in_scope(self, path: str) -> bool:
        include = self._path_patterns("include_paths")
        exclude = self._path_patterns("exclude_paths")

        if include and not any(self._path_matches(path, pattern) for pattern in include):
            return False
        # Applied after include on purpose: an excluded folder nested inside an
        # included one must still be skipped.
        return not any(self._path_matches(path, pattern) for pattern in exclude)

    # ── remote URL handling ──────────────────────────────────────────────

    def _normalized_remote(self) -> str:
        """The repository URL with any inline credentials removed.

        This is the identity the assets are keyed by and the string shown in
        metadata and logs, so it must never carry a secret — a URL of the form
        ``https://user:token@host/org/repo.git`` is otherwise reproduced into
        every asset row.
        """
        url = self._repository_url()
        scp = _SCP_STYLE.match(url)
        if scp and "://" not in url:
            return f"ssh://{scp.group('user')}@{scp.group('host')}/{scp.group('path').lstrip('/')}"

        parts = urlsplit(url)
        if not parts.scheme:
            return url
        host = parts.hostname or ""
        if parts.port:
            host = f"{host}:{parts.port}"
        # The SSH user is part of the address, not a credential; a password is.
        if parts.scheme == "ssh" and parts.username:
            host = f"{parts.username}@{host}"
        return urlunsplit((parts.scheme, host, parts.path, "", ""))

    def _remote_host(self) -> str:
        parts = urlsplit(self._normalized_remote())
        return (parts.hostname or "").lower()

    def _is_ssh_remote(self) -> bool:
        url = self._repository_url()
        return url.startswith("ssh://") or bool(_SCP_STYLE.match(url) and "://" not in url)

    def _web_url(self, key: str) -> str | None:
        """A browser URL for the file on the common hosts, or None.

        Best-effort by design: an unknown host gets no link rather than a guessed
        one that 404s.
        """
        remote = self._normalized_remote()
        parts = urlsplit(remote)
        if parts.scheme not in ("http", "https"):
            return None
        host = (parts.hostname or "").lower()
        path = parts.path.rstrip("/")
        if path.endswith(".git"):
            path = path[: -len(".git")]
        ref = self._commit_sha or self._resolved_branch or "HEAD"
        encoded = quote(key.lstrip("/"), safe="/")
        base = f"{parts.scheme}://{parts.netloc}{path}"
        if host in ("github.com", "gitea.com") or "gitea" in host:
            return f"{base}/blob/{ref}/{encoded}"
        if host == "bitbucket.org":
            return f"{base}/src/{ref}/{encoded}"
        if "gitlab" in host:
            return f"{base}/-/blob/{ref}/{encoded}"
        return None

    # ── isolated workspace ───────────────────────────────────────────────

    def _workspace_dir(self) -> Path:
        """The per-run directory holding the clone, the secrets and a fake HOME.

        Created 0700 and removed in ``cleanup()``. Everything git touches during
        this scan lives under here, which is what keeps two concurrent scans —
        of the same repository or of different ones — from sharing a single
        object, ref or credential.
        """
        if self._workspace is None:
            self._workspace = tempfile.TemporaryDirectory(prefix="classifyre-git-")
            Path(self._workspace.name).chmod(stat.S_IRWXU)
        return Path(self._workspace.name)

    def _write_secret(self, name: str, content: str) -> Path:
        path = self._workspace_dir() / name
        path.write_text(content if content.endswith("\n") else f"{content}\n")
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)
        return path

    def _git_env(self) -> dict[str, str]:
        """The environment every git invocation in this scan runs under.

        Deliberately not the process environment plus a few tweaks. ``HOME`` is
        redirected into the per-run directory and both the system and global
        config files are switched off, so ``~/.gitconfig``, ``~/.netrc``,
        ``~/.ssh`` and any credential helper configured on the runner are all
        unreachable. A scan therefore authenticates with exactly the credentials
        configured on the source and nothing else — and a misconfigured source
        fails cleanly rather than silently succeeding on some other job's
        ambient login.

        Credentials go in through ``GIT_CONFIG_KEY_*`` / ``GIT_CONFIG_VALUE_*``
        rather than command-line ``-c`` arguments so that they never appear in
        the process table.
        """
        if self._env is not None:
            return self._env

        workspace = self._workspace_dir()
        home = workspace / "home"
        home.mkdir(mode=stat.S_IRWXU, exist_ok=True)

        env: dict[str, str] = {
            "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
            "HOME": str(home),
            "LANG": "C",
            "LC_ALL": "C",
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            # Never block a headless scan waiting for a username or passphrase.
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_ASKPASS": "",
            "SSH_ASKPASS": "",
            # LFS payloads are not resolved (the pointer is catalogued instead),
            # so a repository using LFS must not stall on a smudge filter.
            "GIT_LFS_SKIP_SMUDGE": "1",
            "GCM_INTERACTIVE": "never",
        }
        for name in ("SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS"):
            value = os.environ.get(name)
            if value:
                env[name] = value

        config: list[tuple[str, str]] = [
            # Nothing this scan does should consult or populate a credential
            # store; the credentials come from the recipe, per run.
            ("credential.helper", ""),
            ("core.askPass", ""),
            ("advice.detachedHead", "false"),
            ("gc.auto", "0"),
            ("submodule.recurse", "false"),
            ("core.symlinks", "false"),
            ("http.followRedirects", "true"),
            # Belt and braces with the scheme allowlist in _repository_url: the
            # ext transport runs an arbitrary command as the "remote".
            ("protocol.ext.allow", "never"),
        ]
        config.extend(self._auth_config(env))

        for index, (key, value) in enumerate(config):
            env[f"GIT_CONFIG_KEY_{index}"] = key
            env[f"GIT_CONFIG_VALUE_{index}"] = value
        env["GIT_CONFIG_COUNT"] = str(len(config))

        self._env = env
        return env

    def _auth_config(self, env: dict[str, str]) -> list[tuple[str, str]]:
        """Git config entries implementing the configured authentication method.

        Mutates ``env`` for the SSH method, which is configured through
        ``GIT_SSH_COMMAND`` rather than git config.
        """
        method = self._auth_method()
        entries: list[tuple[str, str]] = []

        if not self._auth_option("verify_ssl", True):
            entries.append(("http.sslVerify", "false"))

        ca_certificate = self._masked_value("ca_certificate_pem")
        if ca_certificate:
            entries.append(("http.sslCAInfo", str(self._write_secret("ca.pem", ca_certificate))))

        if method == "none":
            return entries

        if method == "token":
            token = self._masked_value("token")
            if not token:
                raise ValueError(
                    "Token authentication requires masked.token — a personal access, deploy "
                    "or app installation token with read access to the repository."
                )
            username = self._masked_value("username") or _TOKEN_USERNAMES.get(
                self._remote_host(), _DEFAULT_TOKEN_USERNAME
            )
            entries.append(self._basic_auth_header(username, token))
            return entries

        if method == "basic":
            username = self._masked_value("username")
            password = self._masked_value("password")
            if not username or not password:
                raise ValueError(
                    "Basic authentication requires both masked.username and masked.password."
                )
            entries.append(self._basic_auth_header(username, password))
            return entries

        if method == "client_certificate":
            certificate = self._masked_value("client_certificate_pem")
            key = self._masked_value("client_key_pem")
            if not certificate or not key:
                raise ValueError(
                    "Client certificate authentication requires both "
                    "masked.client_certificate_pem and masked.client_key_pem."
                )
            entries.append(("http.sslCert", str(self._write_secret("client.pem", certificate))))
            entries.append(("http.sslKey", str(self._write_secret("client.key", key))))
            return entries

        if method == "ssh_key":
            env["GIT_SSH_COMMAND"] = self._ssh_command(env)
            return entries

        raise ValueError(f"Unsupported Git auth_method '{method}'.")

    @staticmethod
    def _basic_auth_header(username: str, secret: str) -> tuple[str, str]:
        """An ``Authorization: Basic`` header, as a git config entry.

        Preferred over rewriting the remote as ``https://user:token@host/…``:
        that form is recorded in ``.git/config`` and echoed back in error
        messages, whereas the header is only ever held in this process's
        environment.
        """
        encoded = base64.b64encode(f"{username}:{secret}".encode()).decode()
        return ("http.extraHeader", f"Authorization: Basic {encoded}")

    def _ssh_command(self, env: dict[str, str]) -> str:
        private_key = self._masked_value("ssh_private_key")
        if not private_key:
            raise ValueError(
                "SSH authentication requires masked.ssh_private_key — an OpenSSH private key."
            )
        key_path = self._write_secret("id_key", private_key)

        options = [
            "-o",
            "IdentitiesOnly=yes",
            # The runner's own agent must not be able to authenticate this scan.
            "-o",
            "IdentityAgent=none",
            "-o",
            "BatchMode=yes",
            "-o",
            "PreferredAuthentications=publickey",
        ]

        strict = bool(self._auth_option("ssh_strict_host_key_checking", True))
        known_hosts = self._string_or_none(self._auth_option("ssh_known_hosts"))
        if known_hosts:
            known_hosts_path = self._write_secret("known_hosts", known_hosts)
            options += ["-o", f"UserKnownHostsFile={known_hosts_path}"]
        else:
            options += ["-o", f"UserKnownHostsFile={os.devnull}"]
        if strict and known_hosts:
            options += ["-o", "StrictHostKeyChecking=yes"]
        else:
            if strict:
                logger.warning(
                    "Host key checking is enabled but optional.auth.ssh_known_hosts is empty; "
                    "accepting the server's key unverified for this run"
                )
            options += ["-o", "StrictHostKeyChecking=no"]

        passphrase = self._masked_value("ssh_private_key_passphrase")
        if passphrase:
            # ssh only reads a passphrase from a helper program, never from a
            # config value, so the passphrase has to become an executable that
            # prints it. It lives in the 0700 per-run directory and dies with it.
            askpass = self._workspace_dir() / "askpass"
            askpass.write_text('#!/bin/sh\ncat "$(dirname "$0")/passphrase"\n')
            askpass.chmod(stat.S_IRWXU)
            self._write_secret("passphrase", passphrase)
            env["SSH_ASKPASS"] = str(askpass)
            env["SSH_ASKPASS_REQUIRE"] = "force"
            env["DISPLAY"] = env.get("DISPLAY", ":0")

        quoted = " ".join(options)
        return f'ssh -i "{key_path}" {quoted}'

    # ── git plumbing ─────────────────────────────────────────────────────

    def _redact(self, text: str) -> str:
        """Strip anything secret out of git's own output before it is logged."""
        cleaned = re.sub(r"(https?://)[^/\s@]+@", r"\1", text)
        for key in (
            "token",
            "password",
            "ssh_private_key",
            "ssh_private_key_passphrase",
            "client_key_pem",
        ):
            secret = self._masked_value(key)
            if secret and len(secret) >= 4:
                cleaned = cleaned.replace(secret, "***")
        return cleaned

    def _git_max_attempts(self) -> int:
        """How many times a git invocation is attempted before giving up.

        ``CLASSIFYRE_GIT_MAX_ATTEMPTS`` overrides the default; anything that
        is not a positive integer means the default. Read per invocation so a
        long-lived process picks up a changed value without restarting.
        """
        try:
            raw = os.environ.get("CLASSIFYRE_GIT_MAX_ATTEMPTS") or _DEFAULT_GIT_MAX_ATTEMPTS
            return max(1, int(raw))
        except (TypeError, ValueError):
            return _DEFAULT_GIT_MAX_ATTEMPTS

    @staticmethod
    def _is_transient_git_error(message: str) -> bool:
        """Whether this failure is worth retrying rather than reporting."""
        lowered = message.lower()
        return any(pattern in lowered for pattern in _TRANSIENT_GIT_ERROR_PATTERNS)

    @staticmethod
    def _is_missing_object_error(message: str) -> bool:
        """Whether the clone is truncated rather than the network broken."""
        lowered = message.lower()
        return any(pattern in lowered for pattern in _MISSING_OBJECT_PATTERNS)

    @staticmethod
    def _git_retry_delay(attempt: int) -> float:
        return min(
            _GIT_RETRY_BASE_DELAY_SECONDS * (2.0 ** (attempt - 1)), _GIT_RETRY_MAX_DELAY_SECONDS
        )

    def _run_git(
        self,
        args: list[str],
        *,
        cwd: Path | None = None,
        timeout: float | None = None,
    ) -> bytes:
        """Run one git command, retrying transient failures with backoff.

        A dropped connection or a promisor hiccup therefore costs seconds,
        not the scan. Anything that retrying cannot fix — bad credentials, a
        missing branch, an unknown repository — fails on the first attempt.
        """
        command = [self._git_binary(), *args]
        limit = timeout or self._command_timeout_seconds()
        attempts = self._git_max_attempts()
        error: GitCommandError | None = None
        for attempt in range(1, attempts + 1):
            try:
                completed = subprocess.run(
                    command,
                    cwd=str(cwd) if cwd else None,
                    env=self._git_env(),
                    capture_output=True,
                    timeout=limit,
                    check=False,
                )
            except FileNotFoundError as exc:  # pragma: no cover - environment issue
                raise GitCommandError(
                    "The git executable was not found on this runner. Git scanning requires git "
                    "to be installed and on PATH."
                ) from exc
            except subprocess.TimeoutExpired as exc:
                error = GitCommandError(f"git {args[0]} timed out after {exc.timeout:.0f}s")
            else:
                if completed.returncode == 0:
                    return completed.stdout
                stderr = self._redact(completed.stderr.decode("utf-8", errors="replace").strip())
                error = GitCommandError(f"git {args[0]} failed: {stderr or completed.returncode}")

            assert error is not None
            if attempt >= attempts or self._aborted or not self._is_transient_git_error(str(error)):
                raise error
            delay = self._git_retry_delay(attempt)
            logger.warning(
                "git %s failed transiently (attempt %d/%d), retrying in %.0fs: %s",
                args[0],
                attempt,
                attempts,
                delay,
                self._redact(str(error)),
            )
            time.sleep(delay)
        assert error is not None
        raise error

    @staticmethod
    def _git_binary() -> str:
        """The git executable to use.

        ``CLASSIFYRE_GIT_BINARY`` lets a packaged build point at the git
        it ships rather than whatever the user happens to have installed — an
        operational concern, so it is an environment variable rather than a
        field on the source.
        """
        return os.environ.get("CLASSIFYRE_GIT_BINARY") or shutil.which("git") or "git"

    def _repo(self) -> Path:
        if self._repo_dir is None:
            self._clone()
        assert self._repo_dir is not None
        return self._repo_dir

    def _clone_arguments(self) -> list[str]:
        args = ["clone", "--no-checkout", "--single-branch", "--no-tags"]

        strategy = self._clone_strategy()
        if strategy == "blobless":
            args.append("--filter=blob:none")
        elif strategy == "blob_limit":
            args.append(f"--filter=blob:limit={self._max_object_bytes()}")

        depth = self._depth()
        if self._include_last_commit():
            # Per-file commit dates are read out of the branch history, which a
            # shallow clone does not have. Asking for the dates is therefore
            # asking for the history; honouring `depth` here would silently
            # produce the wrong dates instead.
            if depth:
                logger.info(
                    "scope.include_last_commit is on, so the full branch history is fetched "
                    "and connection.depth=%d is ignored",
                    depth,
                )
        elif depth:
            args.append(f"--depth={depth}")

        branch = self._configured_branch()
        if branch:
            args += ["--branch", branch]

        args += ["--", self._repository_url(), "repo"]
        return args

    def _clone(self) -> None:
        workspace = self._workspace_dir()
        target = workspace / "repo"
        logger.info(
            "Cloning %s (%s strategy) into a private per-run directory",
            self._normalized_remote(),
            self._clone_strategy(),
        )
        self._run_git(
            self._clone_arguments(),
            cwd=workspace,
            timeout=self._clone_timeout_seconds(),
        )
        self._repo_dir = target

        self._commit_sha = self._text(["rev-parse", "HEAD"]) or None
        branch = self._text(["rev-parse", "--abbrev-ref", "HEAD"])
        self._resolved_branch = (
            self._configured_branch() or (branch if branch and branch != "HEAD" else None) or "HEAD"
        )
        logger.info(
            "Scanning %s at %s (%s)",
            self._normalized_remote(),
            (self._commit_sha or "unknown")[:12],
            self._resolved_branch,
        )

    def _text(self, args: list[str]) -> str:
        return self._run_git(args, cwd=self._repo_dir).decode("utf-8", errors="replace").strip()

    # ── listing ──────────────────────────────────────────────────────────

    def _list_tree_raw(self, repo: Path) -> bytes:
        """The raw ``ls-tree`` output for the scanned commit.

        Deliberately without ``-l``: the long format needs every blob's size,
        which sends a filtered clone back to the promisor for each file it
        deliberately left on the server — one failed lazy fetch and the whole
        scan dies. The plain format only walks commits and trees, which a
        filtered clone always carries, so listing never touches the network.
        Sizes come from ``_batch_blob_sizes`` instead.
        """
        args = ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]
        limit = self._command_timeout_seconds()
        try:
            return self._run_git(args, cwd=repo, timeout=limit)
        except GitCommandError as exc:
            if not self._is_missing_object_error(str(exc)) or not self._commit_sha:
                raise
            # The clone arrived truncated: a tree the listing needs never made
            # it. The partial-clone filter stays recorded in the repo config,
            # so fetching the scanned commit completes exactly the missing
            # trees without pulling the blobs the strategy left behind.
            logger.warning(
                "Tree objects missing after clone; fetching %s to complete it",
                self._commit_sha[:12],
            )
            self._run_git(
                ["fetch", "--no-tags", "origin", self._commit_sha], cwd=repo, timeout=limit
            )
            return self._run_git(args, cwd=repo, timeout=limit)

    def _batch_blob_sizes(self, repo: Path, oids: list[str]) -> dict[str, int]:
        """The locally-known blob sizes, read straight out of the pack files.

        ``verify-pack -v`` lists every object the clone actually holds, with
        its size, from purely local data: unlike ``ls-tree -l`` or
        ``cat-file --batch-check`` it can neither stall the listing on the
        network nor fail it. Older git versions fetch a missing blob just to
        report its size, and one transient promisor failure then fails the
        whole command — exactly the SCAN FAILED this replaces. A blob with no
        pack entry is one this clone deliberately left on the server (or has
        not fetched yet); its size stays unknown rather than being guessed at.

        Anything unexpected — a failed process, an unparsable line — degrades
        to unknown rather than failing the scan: an unmeasured file is still
        scanned, just spooled to disk instead of held in memory.
        """
        unique = list(dict.fromkeys(oids))
        if not unique or self._clone_strategy() == "blobless":
            return {}
        wanted = set(unique)
        sizes: dict[str, int] = {}
        try:
            pack_dir = repo / ".git" / "objects" / "pack"
            indexes = sorted(pack_dir.glob("*.idx")) if pack_dir.is_dir() else []
            for index in indexes:
                if len(sizes) >= len(wanted):
                    break
                self._accumulate_pack_sizes(repo, index, wanted, sizes)
            for oid in unique:
                if oid in sizes:
                    continue
                # Fresh clones keep everything in packs, but a blob kept as a
                # loose object is still held locally — and asking for the size
                # of an object that exists cannot trigger a fetch.
                if (repo / ".git" / "objects" / oid[:2] / oid[2:]).is_file():
                    try:
                        out = self._run_git(["cat-file", "-s", oid], cwd=repo)
                        sizes[oid] = int(out.decode("utf-8", errors="replace").strip())
                    except (GitCommandError, ValueError):
                        continue
        except OSError as exc:
            logger.warning("Could not read blob sizes, treating every file as unmeasured: %s", exc)
        return sizes

    def _accumulate_pack_sizes(
        self, repo: Path, index: Path, wanted: set[str], sizes: dict[str, int]
    ) -> None:
        """Add the wanted blobs found in one pack index to ``sizes``."""
        try:
            completed = subprocess.run(
                [self._git_binary(), "verify-pack", "-v", str(index)],
                cwd=str(repo),
                env=self._git_env(),
                capture_output=True,
                timeout=self._command_timeout_seconds(),
                check=False,
            )
        except (subprocess.TimeoutExpired, OSError) as exc:
            logger.warning("Could not read blob sizes, treating every file as unmeasured: %s", exc)
            return
        if completed.returncode != 0:
            stderr = self._redact(completed.stderr.decode("utf-8", errors="replace").strip())
            logger.warning(
                "Could not read blob sizes, treating every file as unmeasured: %s",
                stderr or completed.returncode,
            )
            return
        for line in completed.stdout.decode("utf-8", errors="replace").splitlines():
            parts = line.split()
            # "<oid> blob <size> ..." for a blob held locally; pack headers,
            # trees, commits and statistics lines never match and are skipped.
            if len(parts) >= 3 and parts[1] == "blob" and parts[2].isdigit() and parts[0] in wanted:
                sizes[parts[0]] = int(parts[2])
                if len(sizes) >= len(wanted):
                    return

    def _list_objects(self) -> Iterator[ObjectRef]:
        repo = self._repo()
        raw = self._list_tree_raw(repo)

        candidates: list[tuple[str, str]] = []  # (blob object id, repo-relative path)
        for entry in raw.decode("utf-8", errors="replace").split("\0"):
            if self._aborted:
                return
            parsed = self._split_tree_entry(entry)
            if parsed is None:
                continue
            _mode, object_type, oid, path = parsed
            # Submodules are recorded as a commit pointer, not content; symlinks
            # point at a path that has no meaning outside a checked-out worktree.
            if object_type != "blob" or _mode == "120000":
                continue
            cleaned = path.strip().lstrip("/")
            if not cleaned:
                continue
            if not self._path_in_scope(cleaned):
                continue
            if not self._object_matches_extension_filters(cleaned):
                continue
            candidates.append((oid, cleaned))

        sizes = self._batch_blob_sizes(repo, [oid for oid, _ in candidates])

        commit_time = self._commit_time()
        commit_times = self._last_commit_times() if self._include_last_commit() else {}
        self._lfs_globs = self._lfs_tracked_patterns()

        for oid, path in candidates:
            if self._aborted:
                return
            ref = self._make_object_ref(path, oid, sizes.get(oid), commit_time, commit_times)
            if ref is None:
                continue
            self._ref_by_key[ref.key] = ref
            yield ref

    @staticmethod
    def _split_tree_entry(entry: str) -> tuple[str, str, str, str] | None:
        """Split one NUL-separated ``ls-tree`` record into mode, type, id, path."""
        if not entry.strip() or "\t" not in entry:
            return None
        info, path = entry.split("\t", 1)
        fields = info.split()
        if len(fields) < 3:
            return None
        return fields[0], fields[1], fields[2], path

    def _make_object_ref(
        self,
        path: str,
        oid: str,
        size: int | None,
        commit_time: datetime,
        commit_times: dict[str, datetime],
    ) -> GitObjectRef | None:
        # A size of None is a blob this clone does not hold — exactly the
        # files a filtered clone deliberately left on the server. Git cannot
        # report the size of an object it does not have, so it stays 0 until
        # the file is read rather than being guessed at.
        size_known = size is not None
        resolved = size or 0
        if size_known and resolved == 0 and not self._include_empty_objects():
            return None

        return GitObjectRef(
            key=path,
            size=resolved,
            last_modified=commit_times.get(path, commit_time),
            etag=oid,
            blob_id=oid,
            size_known=size_known,
            lfs_pointer=self._is_lfs_tracked(path),
        )

    def _lfs_tracked_patterns(self) -> list[str]:
        """Path patterns whose contents Git LFS holds, from ``.gitattributes``.

        Read once from the attributes file rather than sniffed per file: an LFS
        blob in the tree is a ~130-byte pointer, so it would otherwise be
        catalogued as a tiny text file with no hint that the real payload lives
        elsewhere. Only the repository-root file is consulted — the common case,
        and a nested one would cost a read per directory.
        """
        try:
            raw = self._run_git(["show", "HEAD:.gitattributes"], cwd=self._repo_dir).decode(
                "utf-8", errors="replace"
            )
        except GitCommandError:
            return []

        patterns: list[str] = []
        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "filter=lfs" not in stripped:
                continue
            patterns.append(stripped.split()[0].strip("/"))
        return patterns

    def _is_lfs_tracked(self, path: str) -> bool:
        return any(
            fnmatch(path, pattern) or fnmatch(path.rsplit("/", 1)[-1], pattern)
            for pattern in self._lfs_globs
        )

    def _commit_time(self) -> datetime:
        try:
            return self._parse_datetime(self._text(["log", "-1", "--format=%cI", "HEAD"]))
        except Exception:
            return datetime.now(UTC)

    def _last_commit_times(self) -> dict[str, datetime]:
        """Each file's own last-commit date, from a single walk of the history.

        One ``git log`` pass rather than one invocation per file: the per-file
        form is what makes "order by last change" unusable on a repository with
        any real history.
        """
        try:
            output = self._run_git(
                ["log", "--name-only", "--no-renames", "--format=%x01%cI", "HEAD"],
                cwd=self._repo_dir,
            ).decode("utf-8", errors="replace")
        except GitCommandError as exc:
            logger.warning("Could not read per-file commit dates: %s", exc)
            return {}

        times: dict[str, datetime] = {}
        current: datetime | None = None
        for line in output.splitlines():
            if line.startswith("\x01"):
                current = self._parse_datetime(line[1:].strip())
                continue
            path = line.strip()
            # git log is newest-first, so the first date seen for a path is its
            # most recent change; later (older) commits must not overwrite it.
            if path and current is not None and path not in times:
                times[path] = current
        return times

    # ── content ──────────────────────────────────────────────────────────

    def _blob_id(self, ref: ObjectRef) -> str:
        if isinstance(ref, GitObjectRef) and ref.blob_id:
            return ref.blob_id
        known = self._ref_by_key.get(ref.key)
        if known is not None and known.blob_id:
            return known.blob_id
        raise GitCommandError(f"No Git object id known for {ref.key}")

    def _stream_object(self, ref: ObjectRef) -> Iterator[bytes]:
        """Stream one file's bytes out of the repository.

        In a filtered clone this is the point at which the blob is fetched — one
        request for one file, which is what lets a scan of a small slice of a
        large repository stay small. The blob is written into the per-run object
        store, so a second read of the same file costs nothing and everything is
        discarded together at the end of the run.

        A fetch that fails before producing a single byte is retried: that is
        the promisor failing the handshake, not the file being unreadable.
        Once bytes have flowed the stream is not restarted — the consumer
        already holds a prefix, and a second stream would duplicate it.
        """
        oid = self._blob_id(ref)
        if oid == _EMPTY_BLOB_OID:
            return

        attempts = self._git_max_attempts()
        yielded = 0
        for attempt in range(1, attempts + 1):
            process = subprocess.Popen(
                [self._git_binary(), "cat-file", "blob", oid],
                cwd=str(self._repo()),
                env=self._git_env(),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            assert process.stdout is not None
            outcome: GitCommandError | None = None
            try:
                while True:
                    chunk = process.stdout.read(_CHUNK_BYTES)
                    if not chunk:
                        break
                    yielded += len(chunk)
                    yield chunk
            finally:
                try:
                    process.stdout.close()
                except Exception:  # pragma: no cover - close is best effort
                    pass
                stderr = process.stderr.read() if process.stderr else b""
                if process.stderr is not None:
                    process.stderr.close()
                # Recorded, not raised: raising or returning from inside a
                # finally would silence the exception the stream ended with.
                if process.wait() != 0:
                    message = self._redact(stderr.decode("utf-8", errors="replace").strip())
                    outcome = GitCommandError(
                        f"Could not read {ref.key} from Git: {message or process.returncode}"
                    )
            if outcome is None:
                return
            if (
                yielded > 0
                or attempt >= attempts
                or self._aborted
                or not self._is_transient_git_error(str(outcome))
            ):
                raise outcome
            delay = self._git_retry_delay(attempt)
            logger.warning(
                "Retrying read of %s after transient Git failure (attempt %d/%d): %s",
                ref.key,
                attempt,
                attempts,
                outcome,
            )
            time.sleep(delay)

    def _download_object(self, ref: ObjectRef) -> tuple[bytes, str | None]:
        """Every byte of one file.

        Only the whole-bytes paths use this (binary detectors, container
        expansion); page-oriented reading goes through ``_open_object``, which
        spools instead. The configured hard limit is a refusal rather than a
        truncation — a Parquet cut off at a byte cap has lost the footer that
        indexes its rows and would be recorded as an empty file that scanned
        cleanly.
        """
        limit = self._hard_size_limit_bytes()
        chunks: list[bytes] = []
        total = 0
        for chunk in self._stream_object(ref):
            total += len(chunk)
            if limit is not None and total > limit:
                raise PayloadTooLargeError(
                    f"git:{ref.key} exceeds the configured limit of {limit} bytes"
                )
            chunks.append(chunk)
        return b"".join(chunks), None

    def _is_container_object(self, ref: ObjectRef) -> bool:
        """Whether this file may hold child assets, judged without reading it.

        A file whose size is unknown is one the clone deliberately left on the
        server because it is above the threshold. Treating it as expandable would
        mean downloading it during discovery — the one thing the filtered clone
        exists to avoid — so it is handled the same way an object known to be
        oversized is: catalogued, but not expanded.
        """
        if isinstance(ref, GitObjectRef) and not ref.size_known:
            return False
        return super()._is_container_object(ref)

    # ── asset shape ──────────────────────────────────────────────────────

    def _external_url(self, key: str) -> str:
        """Identity URI for a file.

        The branch is part of it: one source scans one branch, and two sources
        pointed at different branches of the same repository must not collide on
        a single asset. The commit is deliberately *not* part of it, so a commit
        that leaves a file untouched updates its asset instead of forking a new
        one — a change to the bytes is already caught by the blob id in the
        checksum.
        """
        branch = self._resolved_branch or self._configured_branch() or "HEAD"
        return f"git+{self._normalized_remote()}@{branch}/{quote(key.lstrip('/'), safe='/')}"

    def _extra_asset_metadata(self, ref: ObjectRef) -> dict[str, Any]:
        git_ref = ref if isinstance(ref, GitObjectRef) else self._ref_by_key.get(ref.key)
        metadata: dict[str, Any] = {
            "repository_url": self._normalized_remote(),
            "branch": self._resolved_branch or self._configured_branch() or "HEAD",
        }
        if self._commit_sha:
            metadata["commit_sha"] = self._commit_sha
        if git_ref is not None:
            if git_ref.blob_id:
                metadata["blob_id"] = git_ref.blob_id
            if not git_ref.size_known:
                metadata["size_known"] = False
            if git_ref.lfs_pointer:
                # The blob is the LFS pointer, not the payload. Recorded so a
                # 130-byte asset is not mistaken for a 130-byte file.
                metadata["lfs_pointer"] = True
        web_url = self._web_url(ref.key)
        if web_url:
            metadata["web_url"] = web_url
        return metadata

    # ── lifecycle ────────────────────────────────────────────────────────

    def _explain_failure(self, exc: Exception) -> str:
        text = self._redact(str(exc))
        lowered = text.lower()
        if "could not read username" in lowered or "authentication failed" in lowered:
            return (
                f"{text}. The repository is private or the credentials were rejected — set "
                "optional.auth.auth_method and the matching secrets."
            )
        if "permission denied (publickey)" in lowered:
            return (
                f"{text}. The SSH key was rejected: check masked.ssh_private_key is the "
                "private half of a key registered on the server, and that it has read access."
            )
        if "host key verification failed" in lowered:
            return (
                f"{text}. Add the server's host key to optional.auth.ssh_known_hosts "
                "(the output of ssh-keyscan)."
            )
        if "remote branch" in lowered and "not found" in lowered:
            return f"{text}. Check optional.scope.branch names a branch that exists."
        if "certificate" in lowered:
            return f"{text}. For a private certificate authority set masked.ca_certificate_pem."
        return text

    def test_connection(self) -> dict[str, Any]:
        """Verify the remote and the credentials without transferring the repo.

        ``ls-remote`` negotiates and authenticates exactly as a clone does but
        transfers only the ref advertisement, so a broken token is reported in a
        second rather than after cloning a gigabyte.
        """
        result: dict[str, Any] = {
            "timestamp": datetime.now(UTC).isoformat(),
            "source_type": self.recipe.get("type"),
        }
        try:
            branch = self._configured_branch()
            args = ["ls-remote", "--heads", "--", self._repository_url()]
            if branch:
                args.append(branch)
            output = self._run_git(args).decode("utf-8", errors="replace")
            heads = [line for line in output.splitlines() if line.strip()]

            if branch and not heads:
                raise GitCommandError(
                    f"Branch '{branch}' does not exist in {self._normalized_remote()}"
                )

            result["status"] = "SUCCESS"
            scope = f"branch {branch}" if branch else f"{len(heads)} branch(es)"
            result["message"] = (
                f"Connected to {self._normalized_remote()} using "
                f"{self._auth_method()} authentication. Found {scope}."
            )
        except Exception as exc:
            result["status"] = "FAILURE"
            result["message"] = (
                f"Failed to connect to the Git repository: {self._explain_failure(exc)}"
            )
        finally:
            # Testing a connection materialises the credentials into the per-run
            # directory; it must not outlive the test.
            self.cleanup()
        return result

    async def extract_raw(self) -> AsyncGenerator[list[SingleAssetScanResults], None]:
        self._ref_by_key = {}
        async for batch in super().extract_raw():
            yield batch

    def abort(self) -> None:
        logger.info("Aborting Git extraction...")
        super().abort()

    def cleanup(self) -> None:
        super().cleanup()
        workspace = self._workspace
        self._workspace = None
        self._repo_dir = None
        self._env = None
        if workspace is None:
            return
        try:
            workspace.cleanup()
        except Exception:
            # A read-only object file in .git can refuse removal; fall back to a
            # forced delete so no clone survives the run.
            shutil.rmtree(workspace.name, ignore_errors=True)
        logger.debug("Removed the per-run Git workspace")
