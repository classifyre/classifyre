"""Parent-side driver for the notebook bridge subprocess.

Owns the child's lifetime and the NDJSON conversation with it. Every call is
bounded by a wall-clock deadline, because the failure mode this guards against -
a notebook blocked in a socket read with no timeout - cannot be interrupted from
inside Python.
"""

from __future__ import annotations

import json
import logging
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
from collections import deque
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import template

logger = logging.getLogger(__name__)

BRIDGE_FILENAME = "_bridge.py"

#: How many stderr lines to keep for error reporting. The notebook's own prints
#: land here too, so this is a tail, not a transcript.
_STDERR_TAIL = 200

_SANDBOX_ENV = "CLASSIFYRE_NOTEBOOK_SANDBOX"


class NotebookExecutionError(RuntimeError):
    """Raised when the notebook process fails, times out, or misbehaves."""

    def __init__(self, message: str, *, detail: str = "") -> None:
        self.detail = detail
        super().__init__(f"{message}\n{detail}".rstrip())


@dataclass
class BridgeResult:
    refs: list[dict[str, Any]]


def sandbox_enabled() -> bool:
    """Whether to build a per-notebook venv from its inline dependencies.

    On by default. Disabled (running the bridge under the CLI's own interpreter)
    for tests and for offline environments where uv cannot resolve anything.
    """
    raw = os.environ.get(_SANDBOX_ENV)
    if raw is None:
        return shutil.which("uv") is not None
    return raw.strip().lower() not in {"0", "false", "no", "off"}


class NotebookProcess:
    """A running notebook bridge.

    Started lazily on first use and reused across every ``fetch`` in a scan -
    building the sandbox venv and importing the notebook is the expensive part,
    and doing it per asset would dominate the run.
    """

    def __init__(
        self,
        workspace: Path,
        env: dict[str, str],
        *,
        startup_timeout: float = 900.0,
    ) -> None:
        self.workspace = workspace
        self.env = env
        self.startup_timeout = startup_timeout
        self._process: subprocess.Popen[str] | None = None
        self._frames: queue.Queue[dict[str, Any] | None] = queue.Queue()
        self._stderr: deque[str] = deque(maxlen=_STDERR_TAIL)
        self._lock = threading.Lock()
        self._closed = False

    # ── lifecycle ────────────────────────────────────────────────────────

    def _command(self) -> list[str]:
        bridge = str(self.workspace / BRIDGE_FILENAME)
        if sandbox_enabled():
            # `uv run --script` reads the bridge's own PEP 723 header, which we
            # wrote to match the notebook's - so the child lands in a venv that
            # has both the notebook's declared packages and the SDK.
            return ["uv", "run", "--script", bridge]
        return [sys.executable, bridge]

    def start(self) -> None:
        if self._process is not None:
            return

        command = self._command()
        logger.info("Starting notebook process: %s", " ".join(command))
        try:
            self._process = subprocess.Popen(
                command,
                cwd=str(self.workspace),
                env={**os.environ, **self.env},
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
            )
        except FileNotFoundError as exc:
            raise NotebookExecutionError(
                f"Could not start the notebook process ({command[0]} not found)."
            ) from exc

        threading.Thread(target=self._pump_stdout, daemon=True).start()
        threading.Thread(target=self._pump_stderr, daemon=True).start()

        # The sandbox venv is built on this first read, which is why the startup
        # budget is minutes rather than seconds.
        frame = self._await_frame(self.startup_timeout, what="startup")
        if frame.get("t") == "error":
            raise NotebookExecutionError(
                frame.get("message", "Notebook failed to start"),
                detail=frame.get("traceback", "") or self._stderr_tail(),
            )
        if frame.get("t") != "ready":
            raise NotebookExecutionError(f"Unexpected startup frame: {frame}")

    def _pump_stdout(self) -> None:
        assert self._process is not None and self._process.stdout is not None
        try:
            for raw_line in self._process.stdout:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    self._frames.put(json.loads(line))
                except ValueError:
                    # Not a protocol frame. Something wrote to the real stdout
                    # behind our back (a C extension, a subprocess); log it
                    # rather than derailing the run.
                    logger.debug("Non-protocol output from notebook: %s", line[:500])
        finally:
            self._frames.put(None)  # sentinel: pipe closed

    def _pump_stderr(self) -> None:
        assert self._process is not None and self._process.stderr is not None
        for raw_line in self._process.stderr:
            line = raw_line.rstrip()
            if line:
                self._stderr.append(line)
                logger.info("[notebook] %s", line)

    def _stderr_tail(self, limit: int = 40) -> str:
        return "\n".join(list(self._stderr)[-limit:])

    def close(self) -> None:
        with self._lock:
            if self._closed:
                return
            self._closed = True
        process = self._process
        if process is None:
            return
        try:
            if process.poll() is None and process.stdin is not None:
                try:
                    process.stdin.write(json.dumps({"op": "shutdown"}) + "\n")
                    process.stdin.flush()
                except (BrokenPipeError, ValueError):
                    pass
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.kill()
        finally:
            self._process = None

    def kill(self) -> None:
        """Terminate the notebook immediately. The abort path."""
        process = self._process
        if process is None or process.poll() is not None:
            return
        process.kill()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            logger.warning("Notebook process did not die after SIGKILL")

    # ── conversation ─────────────────────────────────────────────────────

    def _send(self, command: dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None or process.poll() is not None:
            raise NotebookExecutionError(
                "The notebook process is not running.", detail=self._stderr_tail()
            )
        try:
            process.stdin.write(json.dumps(command, default=str) + "\n")
            process.stdin.flush()
        except (BrokenPipeError, ValueError) as exc:
            raise NotebookExecutionError(
                "The notebook process exited unexpectedly.", detail=self._stderr_tail()
            ) from exc

    def _await_frame(self, timeout: float, *, what: str) -> dict[str, Any]:
        deadline = time.monotonic() + timeout
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                self.kill()
                raise NotebookExecutionError(
                    f"The notebook did not respond within {timeout:.0f}s during {what}. "
                    "Raise the matching timeout in the source's execution options, "
                    "or add a timeout to the network call the notebook is blocked on.",
                    detail=self._stderr_tail(),
                )
            try:
                frame = self._frames.get(timeout=min(remaining, 1.0))
            except queue.Empty:
                continue
            if frame is None:
                code = self._process.poll() if self._process else None
                raise NotebookExecutionError(
                    f"The notebook process exited during {what}"
                    + (f" (exit code {code})" if code is not None else "")
                    + ".",
                    detail=self._stderr_tail(),
                )
            return frame

    @staticmethod
    def _raise_for_error(frame: dict[str, Any]) -> None:
        if frame.get("t") == "error":
            raise NotebookExecutionError(
                frame.get("message", "The notebook raised an error"),
                detail=frame.get("traceback", ""),
            )

    def check(self, timeout: float) -> None:
        self.start()
        self._send({"op": "check"})
        frame = self._await_frame(timeout, what="check()")
        self._raise_for_error(frame)

    def discover(
        self, timeout: float, *, max_assets: int | None = None
    ) -> Iterator[dict[str, Any]]:
        """Yield refs as the notebook produces them.

        The timeout bounds the gap between frames rather than the whole call, so
        a genuinely long listing keeps running as long as it keeps making
        progress.
        """
        self.start()
        self._send({"op": "discover"})
        emitted = 0
        while True:
            frame = self._await_frame(timeout, what="discover()")
            self._raise_for_error(frame)
            kind = frame.get("t")
            if kind == "ok":
                return
            if kind != "ref":
                raise NotebookExecutionError(f"Unexpected frame during discover(): {frame}")
            yield frame["ref"]
            emitted += 1
            if max_assets is not None and emitted >= max_assets:
                logger.info("Stopping discovery at max_assets=%d", max_assets)
                return

    def fetch(self, ref: dict[str, Any], timeout: float) -> dict[str, Any]:
        self.start()
        self._send({"op": "fetch", "ref": ref})
        frame = self._await_frame(timeout, what=f"fetch({ref.get('id')!r})")
        self._raise_for_error(frame)
        if frame.get("t") != "content":
            raise NotebookExecutionError(f"Unexpected frame during fetch(): {frame}")
        return frame.get("content") or {}


def prepare_workspace(workspace: Path, notebook_source: str, sdk_path: str) -> Path:
    """Materialize the notebook and its bridge into a runnable directory.

    The bridge is given the same PEP 723 header as the notebook so that
    ``uv run --script`` on it produces exactly the environment the notebook was
    written against.
    """
    workspace.mkdir(parents=True, exist_ok=True)

    notebook_source = template.apply_header(notebook_source, sdk_path)
    notebook_path = workspace / template.NOTEBOOK_FILENAME
    notebook_path.write_text(notebook_source, encoding="utf-8")

    bridge_source = (Path(__file__).parent / "bridge.py").read_text(encoding="utf-8")
    # Reuse the notebook's resolved dependency list verbatim.
    header = template.render_header(sdk_path, template.parse_dependencies(notebook_source))
    (workspace / BRIDGE_FILENAME).write_text(header + bridge_source, encoding="utf-8")

    return notebook_path
