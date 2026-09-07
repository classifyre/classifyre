"""Generic child-process plumbing for notebook execution.

``CustomSource`` grew this inline: spawn with a scrubbed env, an NDJSON
handshake with a startup timeout, request/response ``_call``, streamed frames,
SIGTERM-then-SIGKILL abort. Augmentation needs the same shape with one more
turn of the crank — mid-command ``need`` frames the parent serves while the
command is still in flight — so the machinery lives here, once, and both
runtimes build on it.

Blocking IO goes through threads (``call_async``): the CLI's Phase 2 is async
and concurrent, and a bare ``readline()`` on the event loop would stall every
in-flight asset behind one slow notebook.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import sys
import time
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ..sources.custom.env import scrubbed_environment

logger = logging.getLogger(__name__)

#: How long a notebook's definitions get to execute before the run gives up.
STARTUP_TIMEOUT_SECONDS = 120

#: How long a terminated child gets to leave its loop before it is killed.
#: Mirrors ABORT_GRACE_SECONDS in sources/custom/source.py.
ABORT_GRACE_SECONDS = 5


class ChildProcessError(RuntimeError):
    """The notebook child could not be loaded or run."""


#: Serve one ``need`` frame while a command is in flight. Receives the frame
#: and returns the JSON-serializable value for the ``provide`` answer.
NeedHandler = Callable[[dict[str, Any]], Awaitable[Any]]


def _cli_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _describe(error: Any) -> str:
    if not isinstance(error, dict):
        return str(error)
    kind = error.get("type") or "Error"
    message = error.get("message") or ""
    trace = "".join(error.get("traceback") or [])
    return f"{kind}: {message}\n{trace}".strip()


class NotebookChildProcess:
    """One long-lived notebook child, spoken to as request/response NDJSON.

    One process for the whole run, not one per call: a scan augments thousands
    of assets, and paying interpreter startup each time would dominate
    everything else.
    """

    def __init__(
        self,
        module: str,
        *,
        startup_timeout: float = STARTUP_TIMEOUT_SECONDS,
    ) -> None:
        self._module = module
        self._startup_timeout = startup_timeout
        self._process: subprocess.Popen[str] | None = None

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.poll() is None

    def start(self, handshake: dict[str, Any]) -> None:
        """Start the child (or reuse the running one) and complete the handshake."""
        if self.running:
            return
        process = subprocess.Popen(
            [sys.executable, "-m", self._module],
            cwd=_cli_root(),
            env=scrubbed_environment(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,  # inherit: notebook logs belong in the runner log
            text=True,
            bufsize=1,
        )
        self._process = process
        try:
            self._send(handshake)
            frame = self._read_frame_sync(timeout=self._startup_timeout)
        except Exception:
            self.terminate()
            raise
        if frame.get("type") == "error":
            self.terminate()
            raise ChildProcessError(_describe(frame.get("error")))
        if frame.get("type") != "ready":
            self.terminate()
            raise ChildProcessError(f"Notebook process sent an unexpected frame: {frame!r}")

    # -- sync core -----------------------------------------------------------

    def _send(self, payload: dict[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None:
            raise ChildProcessError("Notebook process is not running")
        try:
            process.stdin.write(json.dumps(payload) + "\n")
            process.stdin.flush()
        except (BrokenPipeError, OSError) as exc:
            raise ChildProcessError(f"Notebook process is gone (could not write): {exc}") from exc

    def _read_frame_sync(self, timeout: float | None = None) -> dict[str, Any]:
        process = self._process
        if process is None or process.stdout is None:
            raise ChildProcessError("Notebook process is not running")

        deadline = time.monotonic() + timeout if timeout else None
        line = process.stdout.readline()
        if not line:
            code = process.poll()
            raise ChildProcessError(
                f"Notebook process exited (code {code}) before answering. "
                "Check the scan log for the traceback."
            )
        if deadline is not None and time.monotonic() > deadline:
            raise ChildProcessError(f"Notebook process did not respond within {timeout}s")
        try:
            frame = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ChildProcessError(
                f"Notebook process sent malformed output: {line[:200]!r}"
            ) from exc
        if not isinstance(frame, dict):
            raise ChildProcessError(f"Notebook process sent a non-object frame: {line[:200]!r}")
        return frame

    def call_sync(
        self,
        command: str,
        on_need: Callable[[dict[str, Any]], Any] | None = None,
        **args: Any,
    ) -> Any:
        """One request/response round trip, serving ``need`` frames inline.

        ``on_need`` is sync here; the async wrapper below adapts async servers.
        """
        self._send({"command": command, **args})
        while True:
            frame = self._read_frame_sync()
            frame_type = frame.get("type")
            if frame_type == "need":
                if on_need is None:
                    raise ChildProcessError(f"Notebook asked for {frame.get('op')!r} unprompted")
                try:
                    value = on_need(frame)
                except Exception as exc:
                    self._send({"type": "provide", "id": frame.get("id"), "error": str(exc)})
                    continue
                self._send({"type": "provide", "id": frame.get("id"), "value": value})
                continue
            if frame_type == "error":
                raise ChildProcessError(_describe(frame.get("error")))
            if frame_type == "end":
                return frame.get("result")
            logger.debug("Ignoring unexpected frame from notebook: %s", frame_type)

    # -- async wrapper ---------------------------------------------------------

    async def call(
        self,
        command: str,
        on_need: NeedHandler | None = None,
        **args: Any,
    ) -> Any:
        """Async ``call_sync``: blocking IO in threads, ``need`` served on the loop."""
        # The send itself is one quick write; the read loop is where time goes.
        await asyncio.to_thread(self._send, {"command": command, **args})
        while True:
            frame = await asyncio.to_thread(self._read_frame_sync)
            frame_type = frame.get("type")
            if frame_type == "need":
                if on_need is None:
                    raise ChildProcessError(f"Notebook asked for {frame.get('op')!r} unprompted")
                try:
                    value = await on_need(frame)
                except Exception as exc:
                    await asyncio.to_thread(
                        self._send,
                        {"type": "provide", "id": frame.get("id"), "error": str(exc)},
                    )
                    continue
                await asyncio.to_thread(
                    self._send,
                    {"type": "provide", "id": frame.get("id"), "value": value},
                )
                continue
            if frame_type == "error":
                raise ChildProcessError(_describe(frame.get("error")))
            if frame_type == "end":
                return frame.get("result")
            logger.debug("Ignoring unexpected frame from notebook: %s", frame_type)

    def terminate(self) -> None:
        process, self._process = self._process, None
        if process is None or process.poll() is not None:
            return
        try:
            if process.stdin:
                process.stdin.close()
            process.terminate()
            process.wait(timeout=ABORT_GRACE_SECONDS)
        except subprocess.TimeoutExpired:
            # A loop that never checks ctx.should_abort only stops here.
            process.kill()
            process.wait(timeout=ABORT_GRACE_SECONDS)
        except OSError:
            pass
