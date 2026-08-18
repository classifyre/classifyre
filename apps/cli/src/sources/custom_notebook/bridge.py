"""Child process that imports a custom source notebook and answers requests.

Run by ``uv run --script`` inside the notebook's own PEP 723 sandbox venv, so it
must not import anything from ``src`` - the CLI's package is not on its path.
It talks to the parent over stdin/stdout in newline-delimited JSON.

Why a separate process at all, rather than importing the notebook into the CLI:

* **Dependencies.** The notebook declares its own packages inline; they are
  installed into a venv that is not the CLI's, and cannot be.
* **Containment.** This is user-written code. A segfault, an unkillable C
  extension, or an ``exit()`` in a cell takes down this process and nothing else;
  the parent notices a closed pipe and fails the run with a real message.
* **Timeouts.** A notebook that hangs in a socket read cannot be interrupted from
  inside Python. It can be killed from outside.

One subtlety worth stating: user code calling ``print()`` would corrupt the
protocol, so ``sys.stdout`` is rebound to stderr immediately at startup and the
real stdout is kept privately for protocol frames. Everything the notebook prints
becomes run-log output instead of a parse error.
"""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import sys
import traceback
from datetime import datetime
from typing import Any


def _make_emitter(stream) -> Any:
    def emit(frame: dict[str, Any]) -> None:
        stream.write(json.dumps(frame, default=str) + "\n")
        stream.flush()

    return emit


def _serialize_ref(ref: Any) -> dict[str, Any]:
    """Normalize whatever discover() returned into a ref frame.

    Accepts an SDK ``AssetRef``, a plain dict, or a bare string id, because all
    three are things a person reasonably writes in a notebook and rejecting the
    last two would be pedantry rather than safety.
    """
    if isinstance(ref, str):
        ref = {"id": ref}
    if isinstance(ref, dict):
        data = dict(ref)
    else:
        data = {
            "id": getattr(ref, "id", ""),
            "name": getattr(ref, "name", ""),
            "url": getattr(ref, "url", ""),
            "updated_at": getattr(ref, "updated_at", None),
            "links": list(getattr(ref, "links", ()) or ()),
            "kind": getattr(ref, "kind", "record"),
            "attributes": dict(getattr(ref, "attributes", {}) or {}),
        }

    updated = data.get("updated_at")
    if isinstance(updated, datetime):
        data["updated_at"] = updated.isoformat()
    elif updated is not None:
        data["updated_at"] = str(updated)

    identifier = str(data.get("id") or "").strip()
    if not identifier:
        raise ValueError(
            "discover() returned an asset with no id. Every asset needs a stable "
            "identifier so it can be matched against previous runs."
        )
    data["id"] = identifier
    data.setdefault("name", identifier)
    data.setdefault("url", identifier)
    data["links"] = [str(link) for link in (data.get("links") or ()) if str(link).strip()]
    data["kind"] = str(data.get("kind") or "record")
    attributes = data.get("attributes") or {}
    data["attributes"] = dict(attributes) if isinstance(attributes, dict) else {}
    return data


def _serialize_content(content: Any) -> dict[str, Any]:
    if content is None:
        return {}
    if isinstance(content, str):
        content = {"text": content}
    if isinstance(content, dict):
        data = dict(content)
    else:
        data = {
            "text": getattr(content, "text", None),
            "rows": getattr(content, "rows", None),
            "data": getattr(content, "data", None),
            "mime_type": getattr(content, "mime_type", None),
            "name": getattr(content, "name", None),
            "attributes": dict(getattr(content, "attributes", {}) or {}),
        }

    raw = data.pop("data", None)
    if isinstance(raw, (bytes, bytearray)):
        data["data_b64"] = base64.b64encode(bytes(raw)).decode("ascii")

    rows = data.get("rows")
    if rows is not None:
        # Materialize generators here rather than in the parent: the notebook's
        # iterator only exists in this process.
        data["rows"] = [dict(row) for row in rows]

    attributes = data.get("attributes") or {}
    data["attributes"] = dict(attributes) if isinstance(attributes, dict) else {}
    return data


def _load_notebook(path: str):
    spec = importlib.util.spec_from_file_location("classifyre_custom_notebook", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load notebook at {path}")
    module = importlib.util.module_from_spec(spec)
    # Registering before exec so a notebook that imports itself (or is pickled by
    # a library it uses) resolves to the same module object.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _require(module: Any, name: str):
    fn = getattr(module, name, None)
    if not callable(fn):
        raise RuntimeError(
            f"Notebook does not define a top-level {name}(). In marimo, put it "
            "alone in its own cell and import what it needs from the setup cell."
        )
    return fn


def main() -> int:
    # Claim the real stdout for the protocol, then point everything the notebook
    # might print at stderr.
    protocol_out = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    sys.stdout = sys.stderr  # type: ignore[assignment]
    _emit = _make_emitter(protocol_out)

    notebook_path = os.environ.get("CLASSIFYRE_NOTEBOOK_PATH", "")
    if not notebook_path:
        _emit({"t": "error", "message": "CLASSIFYRE_NOTEBOOK_PATH is not set"})
        return 2

    try:
        module = _load_notebook(notebook_path)
        ctx = getattr(module, "ctx", None)
        if ctx is None:
            from classifyre import context  # type: ignore[import-not-found]

            ctx = context()
    except BaseException as exc:
        _emit(
            {
                "t": "error",
                "message": f"Notebook failed to load: {exc}",
                "traceback": traceback.format_exc(),
            }
        )
        return 1

    _emit({"t": "ready"})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except ValueError:
            _emit({"t": "error", "message": f"Malformed command: {line[:200]}"})
            continue

        op = command.get("op")
        try:
            if op == "shutdown":
                return 0
            if op == "check":
                check = getattr(module, "check", None)
                if callable(check):
                    check(ctx)
                _emit({"t": "ok"})
            elif op == "discover":
                for ref in _require(module, "discover")(ctx) or ():
                    _emit({"t": "ref", "ref": _serialize_ref(ref)})
                _emit({"t": "ok"})
            elif op == "fetch":
                ref_data = command.get("ref") or {}
                _emit(
                    {
                        "t": "content",
                        "content": _serialize_content(
                            _require(module, "fetch")(ctx, _rehydrate(ref_data))
                        ),
                    }
                )
            else:
                _emit({"t": "error", "message": f"Unknown op {op!r}"})
        except BaseException as exc:
            _emit(
                {
                    "t": "error",
                    "message": f"{type(exc).__name__}: {exc}",
                    "traceback": traceback.format_exc(),
                }
            )

    return 0


def _rehydrate(data: dict[str, Any]):
    """Rebuild an AssetRef so fetch() receives the type its signature promises."""
    try:
        from classifyre import AssetRef  # type: ignore[import-not-found]
    except ImportError:
        return data

    updated = data.get("updated_at")
    if isinstance(updated, str) and updated:
        try:
            updated = datetime.fromisoformat(updated)
        except ValueError:
            updated = None
    else:
        updated = None

    return AssetRef(
        id=data.get("id", ""),
        name=data.get("name", ""),
        url=data.get("url", ""),
        updated_at=updated,
        links=data.get("links", ()) or (),
        kind=data.get("kind", "record"),
        attributes=data.get("attributes") or {},
    )


if __name__ == "__main__":
    sys.exit(main())
