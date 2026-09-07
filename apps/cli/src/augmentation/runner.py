"""The child process that runs augmentation notebooks.

Run as ``python -m src.augmentation.runner`` with a scrubbed environment (see
``sources/custom/env.py``). It speaks newline-delimited JSON on stdin/stdout,
with the same skeleton as the CUSTOM connector runner: a handshake, ``READY``,
then one request/response round trip per command.

The one addition is lazy payload. An augmentation runs per asset, and pulling
every asset's bytes across the boundary up front would re-download the source
to enrich it. Instead the child asks: mid-``augment()`` it writes
``{"type": "need", "id": N, "op": "payload" | "raw_pages" | "text"}`` and blocks
on stdin for ``{"type": "provide", "id": N, ...}``. The parent is already inside
the ``await`` for that asset, so the exchange nests cleanly inside the existing
reader — the parent's read loop serves ``need`` frames and keeps reading until
the command's ``END``/``ERROR``.

Why a separate process at all: the parent holds credentials for the whole run
and the key that authenticates result callbacks. A process boundary is the only
thing that actually keeps user code away from those; an AST check is not.
"""

from __future__ import annotations

import inspect
import itertools
import json
import signal
import sys
from collections.abc import Iterator
from typing import Any

from ..graph.edges import edge_to_payload
from ..notebook.execute import cell_filename
from ..notebook.files import local_folders
from ..notebook.redact import RedactingStream, Redactor
from ..notebook.serialize import (
    cell_id_of,
    cell_source_of,
    code_cells,
    to_module_source,
)
from .contract import validate_augmentation_module
from .sdk import (
    AugmentContext,
    AugmentedAsset,
    augmentation_namespace,
    iter_augment_edges,
)

ITEM = "item"
END = "end"
ERROR = "error"
READY = "ready"
NEED = "need"
PROVIDE = "provide"

#: Flipped from a signal handler, so it is a container rather than a rebindable
#: module global.
_ABORT: set[str] = set()

#: Monotonic ids matching ``need`` frames to their ``provide`` answers.
_NEED_IDS = itertools.count(1)


def _aborted() -> bool:
    return bool(_ABORT)


def _on_terminate(_signum: int, _frame: Any) -> None:
    """Ask user code to stop, rather than killing it mid-write."""
    _ABORT.add("requested")


def _emit(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def _await_provide(need_id: int) -> dict[str, Any]:
    """Block for the parent's answer to one ``need`` frame."""
    while True:
        line = sys.stdin.readline()
        if not line:
            raise RuntimeError("Parent closed the channel while payload was pending")
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(frame, dict) and frame.get("type") == PROVIDE and frame.get("id") == need_id:
            return frame
        # Anything else mid-augment is a protocol violation the parent should
        # not be sending; ignore it rather than deadlocking on it.


def _need(op: str) -> Any:
    need_id = next(_NEED_IDS)
    _emit({"type": NEED, "id": need_id, "op": op})
    answer = _await_provide(need_id)
    if "error" in answer:
        raise RuntimeError(str(answer.get("error") or "payload unavailable"))
    return answer.get("value")


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


class AugmentationRuntime:
    """The augmentation notebook's module namespace, loaded once per process."""

    def __init__(
        self,
        recipe: dict[str, Any],
        source: dict[str, Any] | None = None,
    ) -> None:
        self.recipe = recipe
        augmentation = _section(recipe, "augmentation")
        notebook = augmentation.get("notebook")
        self.cells = notebook.get("cells") if isinstance(notebook, dict) else []
        self.context = AugmentContext(
            variables=_string_map(augmentation.get("variables")),
            secrets=_string_map(augmentation.get("secrets")),
            sampling=_section(recipe, "sampling"),
            folders=_augmentation_folders(recipe),
            logger=self._log,
            should_abort=_aborted,
            source=source,
        )
        self.globals: dict[str, Any] = {}

    @staticmethod
    def _log(message: str) -> None:
        # ctx.log goes to stderr: stdout is the data channel, and a notebook
        # that logs would otherwise corrupt the frame stream.
        print(message, file=sys.stderr, flush=True)

    def load(self) -> None:
        """Assemble, check and execute the notebook's definitions."""
        module = to_module_source(self.cells or [])
        validate_augmentation_module(module).raise_if_invalid()

        self.globals = augmentation_namespace(self.context)
        for cell in code_cells(self.cells or []):
            source = cell_source_of(cell)
            exec(compile(source, cell_filename(cell_id_of(cell)), "exec"), self.globals)

    def _require(self, name: str) -> Any:
        function = self.globals.get(name)
        if not callable(function):
            raise RuntimeError(f"The notebook does not define a callable '{name}()'.")
        return function

    # -- commands ------------------------------------------------------------

    def setup(self) -> dict[str, Any]:
        function = self.globals.get("setup")
        if not callable(function):
            return {"result": {"skipped": True}}
        outcome = function()
        edges = [edge_to_payload(edge) for edge in _drain_edges(outcome)]
        return {"result": {"edges": edges}}

    def augment(self, asset: dict[str, Any]) -> dict[str, Any]:
        """Run ``augment(asset)`` over one real asset, lazily serving payload."""
        wrapped = AugmentedAsset(
            hash=str(asset.get("hash") or ""),
            id=str(asset.get("id") or ""),
            name=str(asset.get("name") or ""),
            kind=str(asset.get("kind") or ""),
            url=str(asset.get("url") or ""),
            urn=asset.get("urn"),
            source_type=str(asset.get("source_type") or ""),
            metadata=asset.get("metadata") if isinstance(asset.get("metadata"), dict) else {},
            mime_type=asset.get("mime_type"),
            need=_need,
        )
        function = self._require("augment")
        outcome = function(wrapped)
        # A malformed edge drops that edge with a warning — it does not drop
        # the staged metadata/tags/links beside it. Anything outside the patch
        # shape is ignored with a warning; a bad yield is that, not a failed
        # asset.
        try:
            edges = [edge_to_payload(edge) for edge in _drain_edges(outcome)]
        except TypeError as exc:
            wrapped.warnings.append(f"Ignoring malformed edge: {exc}")
            edges = []
        patch = wrapped.patch()
        patch["edges"] = edges
        return {"result": patch}

    def finalize(self) -> dict[str, Any]:
        function = self.globals.get("finalize")
        if not callable(function):
            return {"result": {"edges": []}}
        edges = [edge_to_payload(edge) for edge in _drain_edges(function())]
        return {"result": {"edges": edges}}


def _drain_edges(outcome: Any) -> list[Any]:
    """Collect edges from a return value that may be a generator, a list, or None."""
    if outcome is None:
        return list(iter_augment_edges(None))
    if inspect.isawaitable(outcome):
        raise TypeError(
            "augment()/setup()/finalize() must be plain functions: async "
            "notebooks are not supported, like in CUSTOM connectors."
        )
    if inspect.isgenerator(outcome) or isinstance(outcome, Iterator):
        collected = list(iter_augment_edges(outcome))
        return collected
    if isinstance(outcome, (list, tuple)):
        return list(iter_augment_edges(outcome))
    return list(iter_augment_edges(outcome))


def _augmentation_folders(recipe: dict[str, Any]) -> dict[str, str]:
    """Local folders declared under ``augmentation.local_folders``.

    The shared ``local_folders()`` helper reads the CUSTOM shape (``optional``
    section plus uploaded files); augmentation declares its own, so resolve the
    small mapping here rather than bending that helper.
    """
    augmentation = _section(recipe, "augmentation")
    folders = augmentation.get("local_folders")
    resolved: dict[str, str] = {}
    if isinstance(folders, list):
        for entry in folders:
            if isinstance(entry, dict) and entry.get("name") and entry.get("path"):
                resolved[str(entry["name"])] = str(entry["path"])
    # Fall back to the shared helper so a recipe that (unusually) declares
    # folders at the top level still resolves.
    try:
        resolved.update(local_folders(recipe))
    except Exception:
        pass
    return resolved


def _handle(runtime: AugmentationRuntime, request: dict[str, Any]) -> dict[str, Any]:
    command = request.get("command")
    if command == "setup":
        return runtime.setup()
    if command == "augment":
        asset = request.get("asset")
        if not isinstance(asset, dict):
            raise ValueError("The 'augment' command needs an 'asset' object")
        return runtime.augment(asset)
    if command == "finalize":
        return runtime.finalize()
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
    # the redactor is installed before any user code can run. from_recipe
    # covers both `masked` and `augmentation.secrets`.
    redactor = Redactor.from_recipe(recipe)
    sys.stderr = RedactingStream(sys.stderr, redactor)

    runtime = AugmentationRuntime(recipe, source=payload.get("source"))
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
