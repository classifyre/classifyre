"""Generate the notebook editor's SDK completions from the SDK itself.

The editor has to offer `ctx.secret(...)` and `Asset(...)` with the right
arguments, and a hand-written list of those would be wrong the first time
someone adds a parameter. So the list is derived by introspecting the runtime
objects a notebook actually receives -- add a method to ``Context`` and the
editor offers it, with its real signature and its real docstring.

Run from apps/cli:

    uv run python scripts/generate_sdk_completions.py

``tests/test_sdk_completions.py`` fails when the checked-in file drifts from
what this would produce, so the two cannot silently diverge.
"""

from __future__ import annotations

import dataclasses
import inspect
import json
import sys
from pathlib import Path
from typing import Any

CLI_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(CLI_ROOT))

from src.notebook.contract import (  # noqa: E402
    OPTIONAL_FUNCTIONS,
    REQUIRED_FUNCTIONS,
)
from src.notebook.sdk import (  # noqa: E402
    Asset,
    Context,
    NotebookFile,
    ParsedContent,
    pages,
    parse,
)

OUTPUT_PATH = (
    CLI_ROOT.parents[1] / "packages" / "schemas" / "src" / "schemas" / "notebook_completions.json"
)


def _summary(obj: Any) -> str:
    """The whole docstring, which is what the editor shows on demand.

    Not just the first paragraph: the part of a docstring that changes what an
    author writes is often the caveat below it -- that reading ``ctx.offset``
    hands paging to the notebook, say -- and truncating to a one-liner is
    exactly how that gets lost.
    """
    return (inspect.getdoc(obj) or "").strip()


def _signature(func: Any, *, drop_self: bool = True) -> str:
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return "()"
    parameters = [
        parameter
        for name, parameter in signature.parameters.items()
        if not (drop_self and name == "self")
    ]
    return str(signature.replace(parameters=parameters))


def _return_type(func: Any) -> str:
    """The annotated return type, rendered as it appears in the source."""
    try:
        annotation = inspect.signature(func).return_annotation
    except (TypeError, ValueError):
        return ""
    if annotation is inspect.Signature.empty:
        return ""
    return str(annotation).strip("'")


def _snippet(name: str, func: Any) -> str:
    """A tab-stop snippet, so calling a method lands the cursor in its first arg."""
    try:
        signature = inspect.signature(func)
    except (TypeError, ValueError):
        return f"{name}()"
    required = [
        parameter_name
        for parameter_name, parameter in signature.parameters.items()
        if parameter_name != "self"
        and parameter.default is inspect.Parameter.empty
        and parameter.kind not in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
    ]
    if not required:
        return f"{name}()"
    placeholders = ", ".join(
        f"${{{index}:{parameter}}}" for index, parameter in enumerate(required, start=1)
    )
    return f"{name}({placeholders})"


#: Public on Context because the runtime reads them, but not part of what a
#: notebook author writes -- offering them would be noise at best and a
#: misleading suggestion at worst.
RUNTIME_ONLY_MEMBERS = frozenset({"set_offset", "offset_consumed", "next_cursor"})


def _members(cls: type) -> list[dict[str, Any]]:
    members: list[dict[str, Any]] = []
    for name, member in sorted(vars(cls).items()):
        if name.startswith("_") or name in RUNTIME_ONLY_MEMBERS:
            continue
        if isinstance(member, property):
            members.append(
                {
                    "label": name,
                    "kind": "property",
                    # A property is read, not called, so showing its getter's
                    # "()" would suggest otherwise. Only the type it yields.
                    "detail": _return_type(member.fget) if member.fget else "",
                    "documentation": _summary(member),
                    "insertText": name,
                }
            )
        elif inspect.isfunction(member) or isinstance(member, staticmethod):
            func = member.__func__ if isinstance(member, staticmethod) else member
            members.append(
                {
                    "label": name,
                    "kind": "method",
                    "detail": _signature(func),
                    "documentation": _summary(func),
                    "insertText": _snippet(name, func),
                }
            )
    return members


def _fields(cls: type) -> list[dict[str, Any]]:
    """Dataclass fields, offered as keyword arguments when constructing one."""
    annotations = getattr(cls, "__annotations__", {})
    dataclass_fields = getattr(cls, "__dataclass_fields__", {})
    fields: list[dict[str, Any]] = []
    for name in annotations:
        if name.startswith("_"):
            continue
        field = dataclass_fields.get(name)
        # dataclasses signal "no default" with MISSING, not Parameter.empty --
        # the wrong sentinel marks every field optional.
        required = field is not None and (
            field.default is dataclasses.MISSING and field.default_factory is dataclasses.MISSING
        )
        fields.append(
            {
                "label": name,
                "kind": "field",
                "detail": str(annotations[name]),
                "required": required,
                "insertText": f"{name}=",
            }
        )
    return fields


#: Module-level helpers a notebook can call directly. Offered alongside `ctx`
#: and `Asset` because `namespace()` pre-binds them, so they are as available as
#: the import line says they are.
MODULE_FUNCTIONS = (("parse", parse), ("pages", pages))


def _function_entry(name: str, func: Any) -> dict[str, Any]:
    return {
        "label": name,
        "kind": "function",
        "detail": _signature(func, drop_self=False),
        "documentation": _summary(func),
        "insertText": _snippet(name, func),
    }


def build() -> dict[str, Any]:
    return {
        "$comment": (
            "Generated by apps/cli/scripts/generate_sdk_completions.py from "
            "apps/cli/src/notebook/sdk.py. Do not edit by hand."
        ),
        "module": "classifyre",
        "globals": [
            {
                "label": "ctx",
                "kind": "variable",
                "detail": "Context",
                "documentation": _summary(Context),
                "insertText": "ctx",
            },
            {
                "label": "Asset",
                "kind": "class",
                "detail": "Asset(...)",
                "documentation": _summary(Asset),
                "insertText": "Asset",
            },
            *(_function_entry(name, func) for name, func in MODULE_FUNCTIONS),
        ],
        "objects": {
            "ctx": {"type": "Context", "members": _members(Context)},
        },
        "classes": {
            "Asset": {
                "documentation": _summary(Asset),
                "fields": _fields(Asset),
            },
            # Returned by `parse()` and reached as `ctx.file(...)`, so an author
            # who never writes their name still needs their members offered.
            "ParsedContent": {
                "documentation": _summary(ParsedContent),
                "fields": _fields(ParsedContent),
            },
            "NotebookFile": {
                "documentation": _summary(NotebookFile),
                "fields": _fields(NotebookFile),
                "members": _members(NotebookFile),
            },
        },
        "contract": {
            "required": list(REQUIRED_FUNCTIONS),
            "optional": list(OPTIONAL_FUNCTIONS),
        },
    }


def main() -> int:
    payload = build()
    OUTPUT_PATH.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH.relative_to(CLI_ROOT.parents[1])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
