"""The child process that actually runs notebook code.

Run as ``python -m src.sources.custom.runner`` with a scrubbed environment (see
``env.py``). It speaks newline-delimited JSON on stdin/stdout so the parent can
consume assets as they are produced -- a connector that yields a million records
must not have to fit them in memory before the first one is scanned.

Why a separate process at all, when the parent already validated the notebook:
the parent holds credentials for the whole run and the key that authenticates
result callbacks. A process boundary is the only thing that actually keeps user
code away from those; an AST check is not.
"""

from __future__ import annotations

import base64
import json
import random
import signal
import sys
from dataclasses import asdict
from typing import Any

from ...notebook.contract import validate_module
from ...notebook.execute import cell_filename
from ...notebook.redact import RedactingStream, Redactor
from ...notebook.sdk import Asset, Context, iter_assets, namespace
from ...notebook.serialize import (
    cell_id_of,
    cell_source_of,
    code_cells,
    to_module_source,
)

ITEM = "item"
END = "end"
ERROR = "error"
READY = "ready"

#: Flipped from a signal handler, so it is a container rather than a rebindable
#: module global.
_ABORT: set[str] = set()


def _aborted() -> bool:
    return bool(_ABORT)


def _on_terminate(_signum: int, _frame: Any) -> None:
    """Ask user code to stop, rather than killing it mid-write.

    ``ctx.should_abort`` flips here, so a loop that checks it exits cleanly and
    the parent gets a proper `end` frame. The parent hard-kills after a grace
    period for loops that do not check.
    """
    _ABORT.add("requested")


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _error_payload(exc: BaseException) -> dict[str, Any]:
    import traceback

    return {
        "type": type(exc).__name__,
        "message": str(exc),
        "traceback": traceback.format_exception(type(exc), exc, exc.__traceback__),
    }


def _section(recipe: dict[str, Any], *path: str) -> dict[str, Any]:
    node: Any = recipe
    for key in path:
        node = (node or {}).get(key) if isinstance(node, dict) else None
    return node if isinstance(node, dict) else {}


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): str(item) for key, item in value.items() if item is not None}


class NotebookRuntime:
    """The notebook's module namespace, loaded once and reused for the run."""

    def __init__(
        self,
        recipe: dict[str, Any],
        cursor: dict[str, Any] | None = None,
        offset: int = 0,
    ) -> None:
        self.recipe = recipe
        notebook = _section(recipe, "required", "notebook")
        self.cells = notebook.get("cells") or []
        self.context = Context(
            variables=_string_map(_section(recipe, "optional").get("variables")),
            secrets=_string_map(_section(recipe, "masked").get("secrets")),
            sampling=_section(recipe, "sampling"),
            cursor=cursor,
            offset=offset,
            logger=self._log,
            should_abort=_aborted,
        )
        self.globals: dict[str, Any] = {}

    @staticmethod
    def _log(message: str) -> None:
        # ctx.log goes to stderr: stdout is the data channel, and a notebook
        # that logs would otherwise corrupt the asset stream.
        print(message, file=sys.stderr, flush=True)

    def load(self) -> None:
        """Assemble, check and execute the notebook's definitions.

        Executed here rather than at import time: ``_discover_sources`` imports
        every module under ``src/sources`` and swallows exceptions, so a notebook
        that failed to compile at import would vanish from the registry with the
        reason logged and lost.
        """
        module = to_module_source(self.cells)
        validate_module(module).raise_if_invalid()

        self.globals = namespace(self.context)
        for cell in code_cells(self.cells):
            source = cell_source_of(cell)
            exec(compile(source, cell_filename(cell_id_of(cell)), "exec"), self.globals)

    def _require(self, name: str) -> Any:
        function = self.globals.get(name)
        if not callable(function):
            raise RuntimeError(f"The notebook does not define a callable '{name}()'.")
        return function

    # -- commands ------------------------------------------------------------

    def test_connection(self) -> dict[str, Any]:
        verdict = self._require("test_connection")()
        if not isinstance(verdict, dict):
            return {
                "status": "FAILURE",
                "message": (
                    'test_connection() must return a dict like {"status": "SUCCESS", '
                    f'"message": "..."}}, got {type(verdict).__name__}'
                ),
            }
        status = str(verdict.get("status", "")).upper()
        return {
            "status": status if status in {"SUCCESS", "FAILURE"} else "FAILURE",
            "message": str(verdict.get("message", "")),
        }

    def discover(self) -> dict[str, Any]:
        function = self.globals.get("discover")
        if not callable(function):
            return {}
        result = function()
        return result if isinstance(result, dict) else {"result": result}

    def extract(
        self,
        *,
        skip: int,
        limit: int | None,
        sampling: str = "window",
        offset: int = 0,
    ) -> dict[str, Any]:
        """Stream assets, honouring the run's sampling window.

        Applied here rather than in the parent so a bounded run stops pulling
        from the source instead of fetching everything and discarding most of it.
        """
        # The window belongs to this run, not to the process, so it is set here
        # rather than at construction.
        self.context.set_offset(offset)
        if sampling == "reservoir" and limit:
            return self._extract_reservoir(limit)
        return self._extract_window(skip=skip, limit=limit)

    def _extract_window(self, *, skip: int, limit: int | None) -> dict[str, Any]:
        produced = 0
        seen = 0
        for asset in iter_assets(self._require("extract")()):
            if _aborted():
                break
            seen += 1
            # Checked per item rather than once up front: `extract()` is a
            # generator, so ctx.offset is not read until its body starts
            # running -- which happens on the way to the first yield.
            if self.context.offset_consumed:
                skip = 0
            if seen <= skip:
                continue
            _emit({"type": ITEM, "data": _asset_to_dict(asset)})
            produced += 1
            if limit is not None and produced >= limit:
                break

        return {
            "produced": produced,
            "seen": seen,
            "aborted": _aborted(),
            "cursor": self.context.next_cursor,
            "offsetHandledByNotebook": self.context.offset_consumed,
        }

    def _extract_reservoir(self, size: int) -> dict[str, Any]:
        """A uniform random sample of the stream, in one pass.

        Taking the first N and calling it random would sample whatever the
        notebook happens to yield first, which is the opposite of what RANDOM
        asks for -- and would silently keep re-scanning the same head of the
        source every run.

        The cost is that the notebook is drained: to sample uniformly you have
        to see everything. A notebook that can sample at the source should read
        ``ctx.strategy`` and do it there, and yield only what it means to.
        """
        reservoir: list[dict[str, Any]] = []
        seen = 0
        for asset in iter_assets(self._require("extract")()):
            if _aborted():
                break
            seen += 1
            payload = _asset_to_dict(asset)
            if len(reservoir) < size:
                reservoir.append(payload)
                continue
            # Each item seen so far has an equal chance of being in the sample.
            index = random.randrange(seen)
            if index < size:
                reservoir[index] = payload

        for payload in reservoir:
            _emit({"type": ITEM, "data": payload})

        return {
            "produced": len(reservoir),
            "seen": seen,
            "aborted": _aborted(),
            "cursor": self.context.next_cursor,
        }

    def fetch_content(self, asset_id: str) -> dict[str, Any] | None:
        function = self.globals.get("fetch_content")
        if not callable(function):
            return None
        result = function(asset_id)
        if result is None:
            return None
        if isinstance(result, str):
            return {"raw": result, "text": result}
        raw, text = result
        return {"raw": str(raw), "text": str(text)}


def _asset_to_dict(asset: Asset) -> dict[str, Any]:
    payload = asdict(asset)
    for key in ("created_at", "updated_at"):
        value = payload.get(key)
        if value is not None and not isinstance(value, str):
            payload[key] = value.isoformat()
    # The channel to the parent is newline-delimited JSON, so raw bytes have to
    # be encoded rather than embedded.
    raw = payload.pop("content_bytes", None)
    if isinstance(raw, bytes):
        payload["content_b64"] = base64.b64encode(raw).decode("ascii")
    return payload


def _handle(runtime: NotebookRuntime, request: dict[str, Any]) -> dict[str, Any]:
    command = request.get("command")
    if command == "test_connection":
        return {"result": runtime.test_connection()}
    if command == "discover":
        return {"result": runtime.discover()}
    if command == "extract":
        return runtime.extract(
            skip=int(request.get("skip") or 0),
            limit=request.get("limit"),
            sampling=str(request.get("sampling") or "window"),
            offset=int(request.get("offset") or 0),
        )
    if command == "fetch_content":
        return {"result": runtime.fetch_content(str(request.get("assetId") or ""))}
    raise ValueError(f"Unknown command {command!r}")


def main() -> int:
    signal.signal(signal.SIGTERM, _on_terminate)
    signal.signal(signal.SIGINT, _on_terminate)

    handshake = sys.stdin.readline()
    if not handshake:
        return 0

    try:
        payload = json.loads(handshake)
        recipe = payload["recipe"]
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        _emit({"type": ERROR, "error": _error_payload(exc)})
        return 2

    # Everything the notebook writes to stderr is streamed into runner logs, so
    # the redactor is installed before any user code can run.
    redactor = Redactor.from_recipe(recipe)
    sys.stderr = RedactingStream(sys.stderr, redactor)  # type: ignore[assignment]

    runtime = NotebookRuntime(
        recipe,
        cursor=payload.get("cursor"),
        offset=int(payload.get("offset") or 0),
    )
    try:
        runtime.load()
    except BaseException as exc:  # reported to the parent, not swallowed
        _emit({"type": ERROR, "error": redactor.redact_deep(_error_payload(exc))})
        return 1

    _emit({"type": READY})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError as exc:
            _emit({"type": ERROR, "error": _error_payload(exc)})
            continue

        try:
            result = _handle(runtime, request)
            _emit({"type": END, **redactor.redact_deep(result)})
        except BaseException as exc:  # reported to the parent, not swallowed
            _emit({"type": ERROR, "error": redactor.redact_deep(_error_payload(exc))})

    return 0


if __name__ == "__main__":
    sys.exit(main())
