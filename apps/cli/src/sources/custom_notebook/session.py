"""Interactive notebook editing session.

Runs a marimo editor over the source's notebook and keeps the database in step
with the file on disk. The editor is the same ``marimo edit`` a person would run
locally; what this module adds is the plumbing that makes it a Classifyre
session rather than a scratch file:

* the notebook is materialized from its current revision, with the SDK path and
  the PEP 723 header rewritten for *this* machine;
* the source's variables and secrets are injected, so the author develops
  against the real credentials without ever typing one into a cell;
* marimo autosaves to the file, and every distinct save becomes a new revision;
* the session ends itself when nobody is editing, because it holds a pod.

The API reverse-proxies this server, which is why ``--base-url`` matters: marimo
builds its asset and websocket URLs from it, and they must match the path the
browser actually requested.
"""

from __future__ import annotations

import hashlib
import logging
import os
import signal
import subprocess
import threading
import time
from pathlib import Path

from . import runner, store, template

logger = logging.getLogger(__name__)

DEFAULT_PORT = 2718
#: How often to look for a change marimo has written out.
POLL_INTERVAL_SEC = 2.0
#: Don't cut a revision until the file has been quiet this long, so a burst of
#: keystroke-level autosaves collapses into one.
QUIET_PERIOD_SEC = 3.0


class NotebookSession:
    def __init__(
        self,
        source_id: str,
        *,
        workspace: Path,
        port: int = DEFAULT_PORT,
        host: str = "127.0.0.1",
        base_url: str = "",
        token: str = "",
        idle_timeout_sec: float = 3600.0,
        env: dict[str, str] | None = None,
    ) -> None:
        self.source_id = source_id
        self.workspace = workspace
        self.port = port
        self.host = host
        self.base_url = base_url
        self.token = token
        self.idle_timeout_sec = idle_timeout_sec
        self.env = env or {}

        self._process: subprocess.Popen[str] | None = None
        self._stop = threading.Event()
        self._notebook_path = workspace / template.NOTEBOOK_FILENAME
        self._last_saved_hash = ""

    # ── setup ────────────────────────────────────────────────────────────

    def materialize(self) -> int:
        """Write the current revision into the workspace. Returns the revision."""
        try:
            notebook = store.load(self.source_id)
            content, revision = notebook.content, notebook.revision
        except store.NotebookUnavailableError as exc:
            # First session on a brand-new source: start from the template
            # rather than making the author face an error before they have had
            # a chance to write anything.
            logger.info("Starting from the starter notebook (%s)", exc)
            content, revision = template.STARTER_NOTEBOOK, 0

        from .source import resolve_sdk_path

        runner.prepare_workspace(self.workspace, content, resolve_sdk_path())
        self._last_saved_hash = _digest(self._notebook_path.read_text(encoding="utf-8"))
        return revision

    def _command(self) -> list[str]:
        command = [
            "marimo",
            "edit",
            str(self._notebook_path),
            "--headless",
            "--host",
            self.host,
            "--port",
            str(self.port),
            "--skip-update-check",
            "--no-skew-protection",
        ]
        if runner.sandbox_enabled():
            # Gives the author marimo's package installer: what they add is
            # inlined into the notebook and is exactly what a scan will run.
            command.append("--sandbox")
        if self.base_url:
            command += ["--base-url", self.base_url]
        if self.token:
            command += ["--token", "--token-password", self.token]
        else:
            command.append("--no-token")
        return command

    # ── run ──────────────────────────────────────────────────────────────

    def start(self) -> None:
        command = self._command()
        logger.info("Starting marimo on %s:%s (base-url=%r)", self.host, self.port, self.base_url)
        self._process = subprocess.Popen(
            command,
            cwd=str(self.workspace),
            env={
                **os.environ,
                **self.env,
                "CLASSIFYRE_NOTEBOOK_MODE": "interactive",
                "CLASSIFYRE_NOTEBOOK_WORKSPACE": str(self.workspace),
                "CLASSIFYRE_NOTEBOOK_PATH": str(self._notebook_path),
            },
        )

    def watch(self) -> None:
        """Persist saves until the editor exits or the session goes idle."""
        last_change = time.monotonic()
        pending_since: float | None = None

        while not self._stop.is_set():
            if self._process is not None and self._process.poll() is not None:
                logger.info("marimo exited with code %s", self._process.returncode)
                break

            digest = self._current_digest()
            if digest and digest != self._last_saved_hash:
                # Wait for the writes to settle before cutting a revision.
                if pending_since is None:
                    pending_since = time.monotonic()
                elif time.monotonic() - pending_since >= QUIET_PERIOD_SEC:
                    self._persist()
                    pending_since = None
                last_change = time.monotonic()
            else:
                pending_since = None

            if self.idle_timeout_sec and time.monotonic() - last_change > self.idle_timeout_sec:
                logger.info("No edits for %.0fs; ending the session.", self.idle_timeout_sec)
                break

            self._stop.wait(POLL_INTERVAL_SEC)

        # A save may still be pending when the editor is closed deliberately.
        self._persist()

    def _current_digest(self) -> str:
        try:
            return _digest(self._notebook_path.read_text(encoding="utf-8"))
        except OSError:
            return ""

    def _persist(self) -> None:
        try:
            content = self._notebook_path.read_text(encoding="utf-8")
        except OSError as exc:
            logger.warning("Could not read the notebook to save it: %s", exc)
            return

        digest = _digest(content)
        if digest == self._last_saved_hash:
            return

        try:
            template.validate(content)
        except template.NotebookValidationError as exc:
            # Save it anyway. A work-in-progress notebook is the normal state of
            # an editing session, and refusing to save would lose the author's
            # work; the scan path validates again before it runs anything.
            logger.info("Saving an incomplete notebook: %s", exc)

        saved = store.save(self.source_id, content, message="Edited in session")
        if saved is not None:
            logger.info("Saved notebook revision %s", saved.revision)
        self._last_saved_hash = digest

    def stop(self) -> None:
        self._stop.set()
        process = self._process
        if process is None or process.poll() is not None:
            return
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()


def _digest(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def run(source_id: str, config: dict, args) -> int:  # type: ignore[no-untyped-def]
    """Entry point for the ``notebook-session`` command."""
    import tempfile

    from .source import CustomNotebookSource

    workspace = Path(args.workspace or tempfile.mkdtemp(prefix=f"classifyre-session-{source_id}-"))

    # Reuse the source's own env builder so an interactive session sees exactly
    # the variables and secrets a scan would.
    probe = CustomNotebookSource(dict(config), source_id=source_id)
    env = {
        key: value
        for key, value in probe._notebook_env().items()
        if key.startswith(("CLASSIFYRE_VAR_", "CLASSIFYRE_SECRET_", "SOURCE_ID"))
    }

    session = NotebookSession(
        source_id,
        workspace=workspace,
        port=args.port,
        host=args.host,
        base_url=args.base_url or "",
        token=os.environ.get("CLASSIFYRE_NOTEBOOK_TOKEN", ""),
        idle_timeout_sec=float(args.idle_timeout or 3600),
        env=env,
    )

    revision = session.materialize()
    logger.info("Editing source %s at notebook revision %s", source_id, revision)

    def _shutdown(signum, _frame):  # type: ignore[no-untyped-def]
        logger.info("Received signal %s; shutting the session down", signum)
        session.stop()

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    session.start()
    try:
        session.watch()
    finally:
        session.stop()
    return 0
