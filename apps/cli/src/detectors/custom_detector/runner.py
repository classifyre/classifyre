"""The child process that runs a code detector's notebook.

Run as ``python -m src.detectors.custom_detector.runner`` with a scrubbed
environment (see ``sources/custom/env.py``). It speaks the augmentation
runner's newline-delimited JSON protocol: a handshake, ``READY``, then one
request/response round trip per command, with lazy payload served through
nested ``need``/``provide`` frames while ``detect()`` runs.

Commands: ``setup`` (once per process) and ``detect`` (once per asset). The
child never writes anything anywhere: ``detect`` answers with finding payloads
and the parent decides what becomes of them.
"""

from __future__ import annotations

import inspect
import itertools
import json
import signal
import sys
from typing import Any

from ...notebook.execute import cell_filename
from ...notebook.redact import RedactingStream, Redactor
from ...notebook.serialize import cell_id_of, cell_source_of, code_cells, to_module_source
from .contract import validate_detector_module
from .sdk import DetectorAsset, DetectorContext, PriorFinding, detector_namespace, iter_findings

END = "end"
ERROR = "error"
READY = "ready"
NEED = "need"
PROVIDE = "provide"

_ABORT: set[str] = set()
_NEED_IDS = itertools.count(1)

#: The frame channel. Captured before any user code runs, because main() then
#: points sys.stdout at stderr: a rule that print()s -- in a cell body, in
#: setup() or in detect() -- must land in the scan log, not in the middle of
#: the NDJSON stream the parent is parsing.
_CHANNEL = sys.stdout


def _aborted() -> bool:
    return bool(_ABORT)


def _on_terminate(_signum: int, _frame: Any) -> None:
    _ABORT.add("requested")


def _emit(payload: dict[str, Any]) -> None:
    _CHANNEL.write(json.dumps(payload) + "\n")
    _CHANNEL.flush()


def _await_provide(need_id: int) -> dict[str, Any]:
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


def _string_map(value: Any) -> dict[str, str]:
    if not isinstance(value, dict):
        return {}
    return {str(key): str(item) for key, item in value.items() if item is not None}


def _positional_arity(function: Any) -> int:
    """How many positional arguments ``function`` accepts (varargs: many)."""
    try:
        parameters = inspect.signature(function).parameters.values()
    except (TypeError, ValueError):
        return 2
    count = 0
    for parameter in parameters:
        if parameter.kind is inspect.Parameter.VAR_POSITIONAL:
            return 99
        if parameter.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            count += 1
    return count


def redactor_for(detector: dict[str, Any]) -> Redactor:
    """A redactor over this detector's secrets (and nothing else)."""
    return Redactor.from_recipe({"masked": {"secrets": _string_map(detector.get("secrets"))}})


class DetectorRuntime:
    """The detector notebook's module namespace, loaded once per process."""

    def __init__(self, detector: dict[str, Any], source: dict[str, Any] | None = None) -> None:
        self.detector = detector
        notebook = detector.get("notebook")
        self.cells = notebook.get("cells") if isinstance(notebook, dict) else []
        self.needs_findings = bool(detector.get("needs_findings"))
        self.context = DetectorContext(
            variables=_string_map(detector.get("variables")),
            secrets=_string_map(detector.get("secrets")),
            sampling=detector.get("sampling") if isinstance(detector.get("sampling"), dict) else {},
            files_dir=detector.get("files_dir") or None,
            logger=self._log,
            should_abort=_aborted,
            source=source,
            detector={"key": detector.get("key"), "name": detector.get("name")},
        )
        self.globals: dict[str, Any] = {}

    @staticmethod
    def _log(message: str) -> None:
        # stdout is the data channel; ctx.log goes to stderr (the scan log).
        print(message, file=sys.stderr, flush=True)

    def load(self) -> None:
        module = to_module_source(self.cells or [])
        validate_detector_module(module).raise_if_invalid()
        self.globals = detector_namespace(self.context)
        for cell in code_cells(self.cells or []):
            exec(
                compile(cell_source_of(cell), cell_filename(cell_id_of(cell)), "exec"), self.globals
            )

    def setup(self) -> dict[str, Any]:
        function = self.globals.get("setup")
        if not callable(function):
            return {"result": {"skipped": True}}
        outcome = function(self.context) if _positional_arity(function) >= 1 else function()
        if inspect.isawaitable(outcome):
            raise TypeError("setup() must be a plain function: async notebooks are not supported.")
        return {"result": {"skipped": False}}

    def detect(self, asset: dict[str, Any], findings: list[Any] | None) -> dict[str, Any]:
        prior = [
            PriorFinding.from_payload(item) for item in (findings or []) if isinstance(item, dict)
        ]
        wrapped = DetectorAsset(
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
            findings=prior,
            findings_enabled=self.needs_findings,
        )
        function = self.globals.get("detect")
        if not callable(function):
            raise RuntimeError("The notebook does not define a callable 'detect()'.")
        outcome = (
            function(wrapped, self.context)
            if _positional_arity(function) >= 2
            else function(wrapped)
        )
        if inspect.isawaitable(outcome):
            raise TypeError("detect() must be a plain function: async notebooks are not supported.")
        payloads = list(iter_findings(outcome))
        return {"result": {"findings": payloads, "warnings": list(wrapped.warnings)}}


def _handle(runtime: DetectorRuntime, request: dict[str, Any]) -> dict[str, Any]:
    command = request.get("command")
    if command == "setup":
        return runtime.setup()
    if command == "detect":
        asset = request.get("asset")
        if not isinstance(asset, dict):
            raise ValueError("The 'detect' command needs an 'asset' object")
        findings = request.get("findings")
        return runtime.detect(asset, findings if isinstance(findings, list) else None)
    raise ValueError(f"Unknown command {command!r}")


def main() -> int:
    signal.signal(signal.SIGTERM, _on_terminate)
    signal.signal(signal.SIGINT, _on_terminate)

    handshake = sys.stdin.readline()
    if not handshake:
        return 0
    try:
        payload = json.loads(handshake)
        detector = payload["detector"]
        if not isinstance(detector, dict):
            raise TypeError("handshake 'detector' must be an object")
    except (json.JSONDecodeError, KeyError, TypeError) as exc:
        _emit({"type": ERROR, "error": _error_payload(exc)})
        return 2

    # Installed before any user code: everything the notebook writes to stderr
    # is streamed into the runner log.
    redactor = redactor_for(detector)
    sys.stderr = RedactingStream(sys.stderr, redactor)
    sys.stdout = sys.stderr

    source = payload.get("source")
    runtime = DetectorRuntime(detector, source=source if isinstance(source, dict) else None)
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
