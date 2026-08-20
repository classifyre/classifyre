"""Cell results as MIME bundles.

A MIME bundle rather than per-library special-casing: a DataFrame already knows
how to render itself as HTML via ``_repr_html_``, a Figure as PNG, and anything
else falls back to ``repr``. That keeps this module from growing a branch every
time someone imports a new library.

The renderer picks the richest type it understands. Anything unrecognized still
carries ``text/plain``, so an unknown MIME type degrades to readable text
instead of an empty output box.
"""

from __future__ import annotations

import base64
from collections.abc import Iterable, Mapping
from typing import Any

STREAM = "stream"
DISPLAY = "display"
ERROR = "error"

#: What the frontend has a renderer for. Ordered richest-first.
RENDERABLE_MIME_TYPES = (
    "image/png",
    "image/svg+xml",
    "text/html",
    "application/json",
    "text/plain",
)

TRUNCATION_NOTE = "\n… output truncated …"


def stream_output(name: str, text: str) -> dict[str, Any]:
    """stdout or stderr written by a cell."""
    return {"type": STREAM, "name": name, "text": text}


def display_output(
    data: Mapping[str, Any],
    metadata: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """A rich result: the same value in as many representations as it offers."""
    return {
        "type": DISPLAY,
        "data": {key: value for key, value in data.items() if key in RENDERABLE_MIME_TYPES},
        "metadata": dict(metadata or {}),
    }


def error_output(
    exception_type: str,
    message: str,
    traceback_lines: Iterable[str] = (),
) -> dict[str, Any]:
    return {
        "type": ERROR,
        "ename": exception_type,
        "evalue": message,
        "traceback": list(traceback_lines),
    }


def png_output(png_bytes: bytes) -> dict[str, Any]:
    return display_output({"image/png": base64.b64encode(png_bytes).decode("ascii")})


def bundle_from_object(value: Any) -> dict[str, str]:
    """Best-effort MIME bundle for an object IPython did not format for us.

    Only used on the fallback path (no IPython display formatter available), so
    it reproduces the few representations that actually matter rather than the
    whole display protocol.
    """
    bundle: dict[str, str] = {}
    for mime, attribute in (
        ("text/html", "_repr_html_"),
        ("image/svg+xml", "_repr_svg_"),
        ("application/json", "_repr_json_"),
    ):
        representer = getattr(value, attribute, None)
        if not callable(representer):
            continue
        try:
            rendered = representer()
        except Exception:  # a broken __repr__ must not fail the cell
            continue
        if isinstance(rendered, str) and rendered:
            bundle[mime] = rendered

    png = getattr(value, "_repr_png_", None)
    if callable(png):
        try:
            raw = png()
        except Exception:
            raw = None
        if isinstance(raw, bytes):
            bundle["image/png"] = base64.b64encode(raw).decode("ascii")
        elif isinstance(raw, str) and raw:
            bundle["image/png"] = raw

    try:
        bundle.setdefault("text/plain", repr(value))
    except Exception:
        bundle.setdefault("text/plain", f"<unrepresentable {type(value).__name__}>")
    return bundle


def _output_size(output: Mapping[str, Any]) -> int:
    if output.get("type") == STREAM:
        return len(str(output.get("text", "")))
    if output.get("type") == DISPLAY:
        return sum(len(str(value)) for value in (output.get("data") or {}).values())
    return sum(len(str(line)) for line in output.get("traceback") or []) + len(
        str(output.get("evalue", ""))
    )


def _truncate_output(output: dict[str, Any], budget: int) -> dict[str, Any]:
    if output.get("type") == STREAM:
        text = str(output.get("text", ""))
        return {**output, "text": text[:budget] + TRUNCATION_NOTE}
    if output.get("type") == DISPLAY:
        # Keep the cheapest representation rather than half of an HTML table,
        # which would render as broken markup.
        data = output.get("data") or {}
        plain = str(data.get("text/plain", ""))[:budget]
        return {**output, "data": {"text/plain": plain + TRUNCATION_NOTE}}
    return output


def cap_outputs(outputs: list[dict[str, Any]], max_bytes: int) -> list[dict[str, Any]]:
    """Bound total output size, keeping the earliest outputs.

    Earliest rather than latest: the first thing a cell printed is usually what
    explains the rest, and a 40 MB base64 image should not evict it.
    """
    if max_bytes <= 0:
        return outputs

    capped: list[dict[str, Any]] = []
    remaining = max_bytes
    for output in outputs:
        size = _output_size(output)
        if size <= remaining:
            capped.append(output)
            remaining -= size
            continue
        if remaining > 0:
            capped.append(_truncate_output(dict(output), remaining))
        capped.append(
            stream_output(
                "stderr",
                f"\n[output limit of {max_bytes} characters reached; "
                f"{len(outputs) - len(capped) + 1} output(s) dropped]\n",
            )
        )
        break
    return capped
